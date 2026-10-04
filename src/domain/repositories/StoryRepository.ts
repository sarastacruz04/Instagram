import type { Story } from '../entities/Story';

export interface StoryRepository {
  /** Historias activas (no vencidas) mías y de quienes sigo. RLS filtra en el servidor. */
  getStoryFeed(): Promise<Story[]>;
  /** Copia persistente de la imagen para la subida diferida (cola offline). */
  persistPendingImage(storyId: string, sourceUri: string): Promise<string>;

  // ---- Estado "visto": LOCAL (SQLite), no en el servidor
  getSeenIds(): Promise<Set<string>>;
  markSeen(storyId: string, expiresAt: string): Promise<void>;
  /** Borra marcas de historias ya vencidas (no crecen para siempre). */
  purgeExpiredSeen(): Promise<void>;
}
