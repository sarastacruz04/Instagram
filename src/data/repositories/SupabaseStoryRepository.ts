import type { Story } from '@/domain/entities/Story';
import { AppError } from '@/domain/errors';
import type { StoryRepository } from '@/domain/repositories/StoryRepository';

import { persistPendingFile } from '../local/pendingFiles';
import { storySeenDao } from '../local/StorySeenDao';
import { supabase } from '../remote/supabaseClient';

interface StoryRow {
  id: string;
  author_id: string;
  username: string;
  avatar_url: string | null;
  image_path: string;
  created_at: string;
  expires_at: string;
}

export class SupabaseStoryRepository implements StoryRepository {
  async getStoryFeed(): Promise<Story[]> {
    const { data, error, status } = await supabase.rpc('get_story_feed');
    if (error) throw new AppError(status === 0 ? 'Sin conexión' : error.message, status === 0 ? 'network' : 'unknown');
    return ((data ?? []) as StoryRow[]).map((r) => ({
      id: r.id,
      authorId: r.author_id,
      username: r.username,
      avatarUrl: r.avatar_url,
      imagePath: r.image_path,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
  }

  persistPendingImage(storyId: string, sourceUri: string): Promise<string> {
    return persistPendingFile(storyId, sourceUri);
  }

  getSeenIds(): Promise<Set<string>> {
    return storySeenDao.seenIds();
  }

  markSeen(storyId: string, expiresAt: string): Promise<void> {
    return storySeenDao.markSeen(storyId, new Date(expiresAt).getTime());
  }

  purgeExpiredSeen(): Promise<void> {
    return storySeenDao.purgeExpired();
  }
}
