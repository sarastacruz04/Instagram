import type { Post } from '../entities/Post';
import type { SyncOperation } from './SyncOperation';

/**
 * Reconciliación: el servidor NO conoce las operaciones que siguen en la cola offline.
 * Si el usuario dio like sin red y luego refresca el feed, el servidor dice liked=false;
 * mostrar eso sería "des-hacer" visualmente su acción. Regla: la intención local pendiente
 * es más reciente que la foto del servidor, así que se aplica ENCIMA.
 *
 * Función PURA (sin I/O ni estado): recibe datos, devuelve datos. Fácil de probar.
 */
export function applyPendingIntents(posts: Post[], pending: SyncOperation[]): Post[] {
  // Última intención de like por post (las operaciones vienen en orden cronológico).
  const likeIntent = new Map<string, boolean>();
  const pendingComments = new Map<string, number>();
  for (const op of pending) {
    if (op.type === 'SET_LIKE') likeIntent.set(op.payload.postId, op.payload.liked);
    if (op.type === 'ADD_COMMENT') {
      pendingComments.set(op.payload.postId, (pendingComments.get(op.payload.postId) ?? 0) + 1);
    }
  }
  if (likeIntent.size === 0 && pendingComments.size === 0) return posts;

  return posts.map((post) => {
    let next = post;
    const liked = likeIntent.get(post.id);
    if (liked !== undefined && liked !== post.likedByMe) {
      next = { ...next, likedByMe: liked, likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)) };
    }
    const extra = pendingComments.get(post.id);
    if (extra) next = { ...next, commentCount: next.commentCount + extra };
    return next;
  });
}

/** Posts creados offline que aún no suben: se reconstruyen desde la cola para mostrarlos. */
export function pendingPostsFrom(
  pending: SyncOperation[],
  me: { id: string; username: string; avatarUrl: string | null },
): Post[] {
  return pending
    .filter((op): op is Extract<SyncOperation, { type: 'CREATE_POST' }> => op.type === 'CREATE_POST')
    .reverse() // el más reciente primero, como el feed
    .map((op) => ({
      id: op.payload.id,
      authorId: me.id,
      authorUsername: me.username,
      authorAvatarUrl: me.avatarUrl,
      imagePath: '',
      localImageUri: op.payload.localUri,
      caption: op.payload.caption,
      likeCount: 0,
      commentCount: 0,
      likedByMe: false,
      createdAt: new Date().toISOString(),
      pending: true,
    }));
}
