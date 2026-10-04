import { getDb, write } from './database';

export const storySeenDao = {
  async seenIds(): Promise<Set<string>> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ story_id: string }>(
      'SELECT story_id FROM story_seen WHERE expires_at > ?',
      Date.now(),
    );
    return new Set(rows.map((r) => r.story_id));
  },

  /** INSERT OR IGNORE: verla dos veces no duplica ni cambia la primera fecha. */
  markSeen(storyId: string, expiresAt: number): Promise<void> {
    return write(async (db) => {
      await db.runAsync(
        'INSERT OR IGNORE INTO story_seen (story_id, seen_at, expires_at) VALUES (?, ?, ?)',
        storyId, Date.now(), expiresAt,
      );
    });
  },

  purgeExpired(): Promise<void> {
    return write(async (db) => {
      await db.runAsync('DELETE FROM story_seen WHERE expires_at <= ?', Date.now());
    });
  },
};
