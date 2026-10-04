import type { Post } from '@/domain/entities/Post';

import { getDb, writeTransaction } from './database';

// Caché local de la primera página del feed. Se guarda el Post serializado (JSON) porque
// solo se lee completo y en orden: no hace falta consultar por columnas.
export const feedCacheDao = {
  /** Reemplaza la caché completa en UNA transacción: nunca queda mitad vieja, mitad nueva. */
  replace(userId: string, posts: Post[]): Promise<void> {
    return writeTransaction(async (db) => {
      await db.runAsync('DELETE FROM feed_cache WHERE user_id = ?', userId);
      const now = Date.now();
      for (let i = 0; i < posts.length; i++) {
        await db.runAsync(
          'INSERT INTO feed_cache (user_id, position, post_json, cached_at) VALUES (?, ?, ?, ?)',
          userId, i, JSON.stringify(posts[i]), now,
        );
      }
    });
  },

  async read(userId: string): Promise<Post[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ post_json: string }>(
      'SELECT post_json FROM feed_cache WHERE user_id = ? ORDER BY position',
      userId,
    );
    return rows.map((r) => JSON.parse(r.post_json) as Post);
  },
};
