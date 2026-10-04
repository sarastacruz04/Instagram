import type { Comment } from '@/domain/entities/Post';
import { AppError } from '@/domain/errors';
import type { CommentRepository } from '@/domain/repositories/PostRepository';

import { COMMENT_COLUMNS, toComment, type CommentRow } from '../mappers/postMapper';
import { supabase } from '../remote/supabaseClient';

export class SupabaseCommentRepository implements CommentRepository {
  async getComments(postId: string): Promise<Comment[]> {
    const { data, error } = await supabase
      .from('comments')
      .select(COMMENT_COLUMNS)
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .returns<CommentRow[]>();
    if (error) throw new AppError(error.message);
    return (data ?? []).map(toComment);
  }

  /**
   * Tiempo real con Supabase Realtime (WebSocket). El servidor lee el WAL de Postgres y
   * emite cada INSERT de `comments` con post_id = este post. RLS se aplica también aquí:
   * solo llegan filas que este usuario puede ver.
   *
   * El evento trae la fila cruda (sin join al autor), así que se pide la fila completa.
   */
  subscribe(postId: string, onInsert: (comment: Comment) => void): () => void {
    const channel = supabase
      .channel(`comments:${postId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` },
        async (payload) => {
          const id = (payload.new as { id: string }).id;
          const { data } = await supabase
            .from('comments')
            .select(COMMENT_COLUMNS)
            .eq('id', id)
            .maybeSingle<CommentRow>();
          if (data) onInsert(toComment(data));
        },
      )
      .subscribe();

    // Cerrar el canal al salir de la pantalla: un WebSocket suscrito sin pantalla es una fuga.
    return () => {
      supabase.removeChannel(channel);
    };
  }
}
