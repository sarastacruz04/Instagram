import { getDb, write } from './database';

export interface ImageCacheRow {
  cache_key: string;
  file_name: string;
  bytes: number;
  last_access: number;
}

// Índice del caché de imágenes en disco. El orden LRU del disco es `last_access`
// (con índice): encontrar las más viejas es una búsqueda por índice, no un recorrido.
export const imageCacheDao = {
  async get(key: string): Promise<ImageCacheRow | null> {
    const db = await getDb();
    return db.getFirstAsync<ImageCacheRow>('SELECT * FROM image_cache WHERE cache_key = ?', key);
  },

  upsert(key: string, fileName: string, bytes: number): Promise<void> {
    return write(async (db) => {
      await db.runAsync(
        `INSERT INTO image_cache (cache_key, file_name, bytes, last_access) VALUES (?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET file_name = excluded.file_name, bytes = excluded.bytes,
                                              last_access = excluded.last_access`,
        key, fileName, bytes, Date.now(),
      );
    });
  },

  /** Marca el acceso (sube a "más reciente" en el LRU de disco). */
  touch(key: string): Promise<void> {
    return write(async (db) => {
      await db.runAsync('UPDATE image_cache SET last_access = ? WHERE cache_key = ?', Date.now(), key);
    });
  },

  async totalBytes(): Promise<number> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ total: number }>('SELECT COALESCE(SUM(bytes), 0) AS total FROM image_cache');
    return row?.total ?? 0;
  },

  async count(): Promise<number> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM image_cache');
    return row?.n ?? 0;
  },

  /** Las N entradas usadas hace más tiempo (candidatas a desalojo). */
  async oldest(limit: number): Promise<ImageCacheRow[]> {
    const db = await getDb();
    return db.getAllAsync<ImageCacheRow>('SELECT * FROM image_cache ORDER BY last_access ASC LIMIT ?', limit);
  },

  remove(key: string): Promise<void> {
    return write(async (db) => {
      await db.runAsync('DELETE FROM image_cache WHERE cache_key = ?', key);
    });
  },

  clear(): Promise<void> {
    return write(async (db) => {
      await db.runAsync('DELETE FROM image_cache');
    });
  },
};
