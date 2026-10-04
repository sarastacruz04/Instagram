import type { Post } from '@/domain/entities/Post';
import { AppError } from '@/domain/errors';
import type { Page, PostRepository } from '@/domain/repositories/PostRepository';

import { feedCacheDao } from '../local/FeedCacheDao';
import { persistPendingFile } from '../local/pendingFiles';
import { toPost, type PostRow } from '../mappers/postMapper';
import { currentUserId, supabase } from '../remote/supabaseClient';

const FEED_PAGE = 12;
const GRID_PAGE = 30;

type RpcResult = { data: PostRow[] | null; error: { message: string } | null; status: number };

function toPage(res: RpcResult, pageSize: number): Page<Post> {
  if (res.error) {
    throw new AppError(res.status === 0 ? 'Sin conexión' : res.error.message, res.status === 0 ? 'network' : 'unknown');
  }
  const items = (res.data ?? []).map(toPost);
  return {
    items,
    // Si llegó una página completa, probablemente hay más: el cursor es el created_at del último.
    nextCursor: items.length === pageSize ? items[items.length - 1].createdAt : null,
  };
}

export class SupabasePostRepository implements PostRepository {
  /**
   * Offline-first para la primera página:
   *  - Con red: se pide al servidor y se REEMPLAZA la caché local.
   *  - Sin red: se devuelve lo último guardado en SQLite (fromCache: true).
   */
  async getFeed(cursor: string | null): Promise<Page<Post>> {
    const userId = await currentUserId();
    const res = await supabase.rpc('get_feed', { p_before: cursor, p_limit: FEED_PAGE });

    if (res.error && res.status === 0 && cursor === null) {
      const cached = await feedCacheDao.read(userId);
      return { items: cached, nextCursor: null, fromCache: true };
    }
    const page = toPage(res, FEED_PAGE);
    if (cursor === null) await feedCacheDao.replace(userId, page.items);
    return page;
  }

  async getExplore(cursor: string | null): Promise<Page<Post>> {
    return toPage(await supabase.rpc('get_explore', { p_before: cursor, p_limit: GRID_PAGE }), GRID_PAGE);
  }

  async getUserPosts(userId: string, cursor: string | null): Promise<Page<Post>> {
    return toPage(
      await supabase.rpc('get_user_posts', { p_user: userId, p_before: cursor, p_limit: GRID_PAGE }),
      GRID_PAGE,
    );
  }

  async getPost(id: string): Promise<Post | null> {
    const res = await supabase.rpc('get_post', { p_id: id });
    // RLS: si el post es de una cuenta privada que no sigo, simplemente no viene → null.
    return toPage(res, 1).items[0] ?? null;
  }

  persistPendingImage(postId: string, sourceUri: string): Promise<string> {
    return persistPendingFile(postId, sourceUri);
  }
}
