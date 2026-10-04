import { AppError } from '@/domain/errors';
import type { MediaRepository } from '@/domain/repositories/MediaRepository';

import { supabase } from '../remote/supabaseClient';

const TTL_SECONDS = 60 * 60;          // cada firma dura 1 hora
const REFRESH_MARGIN_MS = 5 * 60_000; // se re-firma si le quedan menos de 5 minutos

interface Signed {
  url: string;
  expiresAt: number;
}

/**
 * Firma URLs del bucket privado `media` con dos optimizaciones:
 *
 * 1. Memoización: una URL válida se reutiliza hasta poco antes de caducar.
 * 2. AGRUPAMIENTO (batching): cuando el feed monta 10 celdas en el mismo frame, cada una pide
 *    su URL. En vez de 10 peticiones HTTP, las solicitudes del mismo "tick" se juntan y se
 *    resuelven con UNA llamada a createSignedUrls. queueMicrotask agenda el envío para justo
 *    después del código síncrono actual, cuando ya se registraron todas las solicitudes.
 */
export class SupabaseMediaRepository implements MediaRepository {
  private readonly signed = new Map<string, Signed>();
  private readonly waiting = new Map<string, { resolve: (u: string) => void; reject: (e: Error) => void }[]>();
  private flushScheduled = false;

  getSignedUrl(path: string): Promise<string> {
    const hit = this.signed.get(path);
    if (hit && hit.expiresAt - Date.now() > REFRESH_MARGIN_MS) return Promise.resolve(hit.url);

    return new Promise((resolve, reject) => {
      const list = this.waiting.get(path) ?? [];
      list.push({ resolve, reject }); // si ya se pidió en este tick, se une a la misma espera
      this.waiting.set(path, list);
      if (!this.flushScheduled) {
        this.flushScheduled = true;
        queueMicrotask(() => void this.flush());
      }
    });
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    const batch = new Map(this.waiting);
    this.waiting.clear();
    const paths = [...batch.keys()];

    const { data, error } = await supabase.storage.from('media').createSignedUrls(paths, TTL_SECONDS);
    const expiresAt = Date.now() + TTL_SECONDS * 1000;

    for (const path of paths) {
      const waiters = batch.get(path) ?? [];
      const item = data?.find((d) => d.path === path);
      const url = item?.signedUrl;
      if (error || !url) {
        // RLS: si no puedo ver al dueño (cuenta privada), Storage NO firma la URL.
        const err = new AppError(error?.message ?? item?.error ?? 'Sin acceso a la imagen', 'forbidden');
        waiters.forEach((w) => w.reject(err));
      } else {
        this.signed.set(path, { url, expiresAt });
        waiters.forEach((w) => w.resolve(url));
      }
    }
  }
}
