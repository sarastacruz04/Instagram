import type { ImageRef } from 'expo-image';

// PUERTO (contrato) del motor de caché de imágenes. La presentación depende de ESTA
// interfaz; la implementación (ImageCacheEngine, capa data) solo la conoce di/container.ts.
// Vive en `core` y no en `domain` porque expone ImageRef, un tipo de infraestructura
// (bitmap nativo de expo-image) que no tiene sentido en el dominio del negocio.

/** Lo que recibe quien pide una imagen: el bitmap y la obligación de soltarlo. */
export interface ImageHandle {
  ref: ImageRef;
  /** Llamar cuando se deja de mostrar la imagen (desmontaje, reciclaje, pérdida de foco). */
  release(): void;
}

export interface ImageCacheStats {
  memoryHits: number;
  diskHits: number;
  networkLoads: number;
  deduplicated: number;
  cancelled: number;
  memoryEvictions: number;
  diskEvictions: number;
  memoryBytes: number;
  memoryItems: number;
  pinned: number;
  inFlight: number;
}

export interface ImageCache {
  acquire(key: string, resolveUrl: () => Promise<string>, widthPx: number, signal: AbortSignal): Promise<ImageHandle>;
  trimMemory(targetBytes: number): number;
  clearDisk(): Promise<void>;
  getStats(): ImageCacheStats;
  getDiskStats(): Promise<{ bytes: number; files: number; budget: number }>;
  readonly memoryBudget: number;
}
