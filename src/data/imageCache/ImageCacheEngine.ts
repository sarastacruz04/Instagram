import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Image, type ImageRef } from 'expo-image';
import { AppState } from 'react-native';

import type { ImageCache, ImageCacheStats, ImageHandle } from '@/core/cache/ImageCache';
import { LruCache } from '@/core/cache/LruCache';

import { imageCacheDao } from '../local/ImageCacheDao';

// Presupuestos (ajustables). Con decodificación a 1080 px una foto ocupa ~4.6 MB en RAM:
// 64 MB ≈ 13 fotos grandes a pantalla completa o ~120 miniaturas de la grilla.
const MEMORY_BUDGET_BYTES = 64 * 1024 * 1024;
const DISK_BUDGET_BYTES = 150 * 1024 * 1024;
const DISK_EVICT_BATCH = 20;

interface MemoryEntry {
  ref: ImageRef;
  bytes: number;
  /** Cuántas celdas MUESTRAN este bitmap ahora. Si > 0 no se puede desalojar. */
  users: number;
  /** Ya salió de la LRU y su bitmap se liberó: no se debe volver a usar. */
  evicted: boolean;
}

interface Job {
  promise: Promise<MemoryEntry>;
  controller: AbortController;
  /** Cuántos interesados esperan esta carga. Si llega a 0 se aborta la descarga real. */
  waiters: number;
}

function abortError(): Error {
  const e = new Error('Carga de imagen cancelada');
  e.name = 'AbortError';
  return e;
}

/**
 * MOTOR DE CACHÉ DE IMÁGENES DE DOS NIVELES (propio, sin caché automático de terceros).
 *
 *  L1 · RAM   → LruCache de ImageRef: bitmaps YA DECODIFICADOS en memoria nativa, con
 *               presupuesto en bytes (ancho × alto × 4). Al desalojar se llama a release().
 *  L2 · DISCO → archivos JPEG en Paths.cache/img + índice SQLite (bytes, last_access),
 *               presupuesto de 150 MB con desalojo LRU.
 *  Red        → URL (firmada) → descarga nativa cancelable con AbortSignal.
 *
 * HILOS: la lógica de este motor corre en el hilo JS pero solo coordina. Descargar, escribir
 * el archivo, calcular el SHA-256, leer SQLite y DECODIFICAR el JPEG ocurren en hilos nativos
 * de fondo; el hilo JS solo espera Promises. Por eso el scroll no se traba.
 */
export class ImageCacheEngine implements ImageCache {
  private readonly dir = new Directory(Paths.cache, 'img');
  private readonly inflight = new Map<string, Job>();
  private readonly stats = {
    memoryHits: 0, diskHits: 0, networkLoads: 0, deduplicated: 0,
    cancelled: 0, memoryEvictions: 0, diskEvictions: 0,
  };

  private readonly memory = new LruCache<string, MemoryEntry>({
    maxWeight: MEMORY_BUDGET_BYTES,
    weigh: (e) => e.bytes,
    // Nunca se desaloja un bitmap que alguna celda está mostrando (liberarlo dejaría la celda
    // apuntando a memoria nativa ya liberada).
    canEvict: (_k, e) => e.users === 0,
    onEvict: (_k, e) => {
      this.stats.memoryEvictions++;
      e.evicted = true;
      e.ref.release(); // libera el bitmap nativo YA, sin esperar al recolector de basura de JS
    },
  });

  constructor() {
    this.dir.create({ intermediates: true, idempotent: true });

    // Presión de memoria: si el SO avisa que queda poca RAM, se sueltan todos los bitmaps
    // que no están en pantalla (el disco los recupera rápido). Así evitamos que el SO
    // mate la app por OutOfMemory.
    AppState.addEventListener('memoryWarning', () => this.trimMemory(0));
    // En segundo plano el SO es más agresivo matando apps con mucha RAM: se suelta la mitad.
    AppState.addEventListener('change', (s) => {
      if (s === 'background') this.trimMemory(MEMORY_BUDGET_BYTES / 2);
    });
  }

  /**
   * Obtiene una imagen decodificada al ancho indicado (en píxeles físicos).
   * @param key     llave ESTABLE (ruta del bucket), no la URL firmada que cambia.
   * @param resolveUrl cómo obtener la URL de descarga si hay que ir a la red.
   * @param signal  se aborta cuando la celda sale del viewport o se recicla.
   */
  acquire(key: string, resolveUrl: () => Promise<string>, widthPx: number, signal: AbortSignal): Promise<ImageHandle> {
    if (signal.aborted) return Promise.reject(abortError());

    // Tamaños discretos (múltiplos de 256 px): más aciertos en RAM entre pantallas parecidas.
    const width = Math.min(2048, Math.max(256, Math.ceil(widthPx / 256) * 256));
    const memKey = `${key}@${width}`;

    // ---- L1: RAM
    const hit = this.memory.get(memKey);
    if (hit) {
      this.stats.memoryHits++;
      return Promise.resolve(this.pin(memKey, hit));
    }

    // ---- Deduplicación: si ya hay una carga en curso de la misma imagen, se une a ella.
    let job = this.inflight.get(memKey);
    if (job) this.stats.deduplicated++;
    else job = this.startJob(key, memKey, width, resolveUrl);
    const current = job;
    current.waiters++;

    return new Promise<ImageHandle>((resolve, reject) => {
      const onAbort = () => {
        current.waiters--;
        // Si NADIE más espera esta imagen, se cancela la descarga/decodificación real.
        if (current.waiters === 0) current.controller.abort();
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });

      current.promise.then(
        (entry) => {
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) return; // ya se rechazó en onAbort
          current.waiters--;
          resolve(this.pin(memKey, entry));
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) return;
          current.waiters--;
          reject(error);
        },
      );
    });
  }

  private startJob(key: string, memKey: string, width: number, resolveUrl: () => Promise<string>): Job {
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const file = await this.ensureOnDisk(key, resolveUrl, controller.signal);
        if (controller.signal.aborted) throw abortError();

        // DECODIFICACIÓN REDUCIDA (downsampling): el JPEG se decodifica directamente al ancho
        // que se va a mostrar, en un hilo nativo. Una miniatura de 360 px ocupa ~0.5 MB en vez
        // de ~4.6 MB. Es la mayor defensa contra OutOfMemory en listas largas.
        const ref = await Image.loadAsync({ uri: file.uri }, { maxWidth: width });
        if (controller.signal.aborted) {
          ref.release(); // nadie lo quiere ya: liberar el bitmap recién decodificado
          throw abortError();
        }
        const scale = ref.scale || 1;
        const entry: MemoryEntry = {
          ref,
          bytes: Math.round(ref.width * scale * ref.height * scale * 4), // RGBA = 4 bytes/píxel
          // RESERVA: nace fijada (users = 1). Entre este punto y el momento en que cada celda
          // que esperaba la fija (pin), otra inserción podría desalojarla y liberar el bitmap.
          // La reserva se suelta en el siguiente turno del event loop (setTimeout 0), que corre
          // DESPUÉS de todos los callbacks .then (microtareas) de los interesados.
          users: 1,
          evicted: false,
        };
        this.memory.set(memKey, entry);
        setTimeout(() => this.unpin(entry), 0);
        return entry;
      } catch (e) {
        if ((e as Error).name === 'AbortError') this.stats.cancelled++;
        throw e;
      } finally {
        this.inflight.delete(memKey);
      }
    })();
    promise.catch(() => {}); // los errores se entregan a cada interesado; evita "unhandled rejection"
    const job: Job = { promise, controller, waiters: 0 };
    this.inflight.set(memKey, job);
    return job;
  }

  /** Marca el bitmap como "en uso" y devuelve la función para soltarlo (una sola vez). */
  private pin(memKey: string, entry: MemoryEntry): ImageHandle {
    entry.users++;
    let released = false;
    return {
      ref: entry.ref,
      release: () => {
        if (released) return; // idempotente: soltar dos veces no descuadra el conteo
        released = true;
        this.unpin(entry);
      },
    };
  }

  private unpin(entry: MemoryEntry): void {
    entry.users--;
    // Ya nadie lo muestra: si la RAM estaba por encima del presupuesto (por entradas fijadas
    // que no se podían desalojar), ahora sí se desaloja lo que sobre.
    if (entry.users === 0 && !entry.evicted) this.memory.trim();
  }

  // ------------------------------------------------------------------ nivel L2 (disco)

  private async ensureOnDisk(key: string, resolveUrl: () => Promise<string>, signal: AbortSignal): Promise<File> {
    const row = await imageCacheDao.get(key);
    if (row) {
      const cached = new File(this.dir, row.file_name);
      if (cached.exists) {
        this.stats.diskHits++;
        void imageCacheDao.touch(key); // actualizar last_access sin bloquear la carga
        return cached;
      }
      await imageCacheDao.remove(key); // el SO borró el archivo (Paths.cache es purgable)
    }

    // ---- Miss total: a la red
    this.stats.networkLoads++;
    const fileName = `${await digestStringAsync(CryptoDigestAlgorithm.SHA256, key)}.img`;
    const url = await resolveUrl();
    if (signal.aborted) throw abortError();

    // Se descarga a un archivo temporal y luego se RENOMBRA. Si la descarga se cancela o la
    // app muere a mitad, nunca queda un archivo a medias con el nombre final (que al leerlo
    // daría una imagen corrupta). El rename dentro del mismo directorio es atómico.
    const part = new File(this.dir, `${fileName}.part`);
    const target = new File(this.dir, fileName);
    try {
      // Descarga NATIVA en hilo de fondo; el AbortSignal la cancela en el sistema operativo.
      await File.downloadFileAsync(url, part, { signal, idempotent: true });
      await part.move(target, { overwrite: true });
    } catch (e) {
      try {
        if (part.exists) part.delete();
      } catch {}
      throw signal.aborted ? abortError() : e;
    }

    await imageCacheDao.upsert(key, fileName, target.size ?? 0);
    void this.enforceDiskBudget();
    return target;
  }

  /** Desaloja del disco las imágenes usadas hace más tiempo hasta quedar bajo el presupuesto. */
  private diskTrimRunning = false;
  private async enforceDiskBudget(): Promise<void> {
    if (this.diskTrimRunning) return; // una sola pasada a la vez
    this.diskTrimRunning = true;
    try {
      let total = await imageCacheDao.totalBytes();
      while (total > DISK_BUDGET_BYTES) {
        const victims = await imageCacheDao.oldest(DISK_EVICT_BATCH);
        if (victims.length === 0) break;
        for (const v of victims) {
          try {
            const f = new File(this.dir, v.file_name);
            if (f.exists) f.delete();
          } catch {}
          await imageCacheDao.remove(v.cache_key);
          total -= v.bytes;
          this.stats.diskEvictions++;
        }
      }
    } finally {
      this.diskTrimRunning = false;
    }
  }

  // ------------------------------------------------------------------ mantenimiento / demo

  /** Suelta bitmaps que no están en pantalla hasta quedar en `targetBytes`. */
  trimMemory(targetBytes: number): number {
    return this.memory.trimTo(targetBytes);
  }

  async getDiskStats(): Promise<{ bytes: number; files: number; budget: number }> {
    const [bytes, files] = await Promise.all([imageCacheDao.totalBytes(), imageCacheDao.count()]);
    return { bytes, files, budget: DISK_BUDGET_BYTES };
  }

  get memoryBudget(): number {
    return MEMORY_BUDGET_BYTES;
  }

  async clearDisk(): Promise<void> {
    await imageCacheDao.clear();
    try {
      this.dir.delete();
    } catch {}
    this.dir.create({ intermediates: true, idempotent: true });
  }

  getStats(): ImageCacheStats {
    let pinned = 0;
    // Recorrer para contar las fijadas es O(n): solo lo usa el panel de diagnóstico.
    for (const entry of this.memory.values()) if (entry.users > 0) pinned++;
    return {
      ...this.stats,
      memoryBytes: this.memory.weight,
      memoryItems: this.memory.size,
      pinned,
      inFlight: this.inflight.size,
    };
  }
}
