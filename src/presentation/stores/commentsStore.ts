import { create } from 'zustand';

import { newId } from '@/core/ids';
import { commentRepository, syncQueue } from '@/di/container';
import type { Comment } from '@/domain/entities/Post';

import { bumpCommentCount } from './postsStore';
import { useSession } from './sessionStore';

// Comentarios por post. Vive en un store global (no en la pantalla) porque los eventos
// del SyncEngine (confirmación / rechazo) pueden llegar cuando la pantalla ya se cerró.
interface CommentsState {
  byPost: Record<string, Comment[]>;
}

export const useComments = create<CommentsState>(() => ({ byPost: {} }));

function setPostComments(postId: string, update: (list: Comment[]) => Comment[]): void {
  useComments.setState((s) => ({ byPost: { ...s.byPost, [postId]: update(s.byPost[postId] ?? []) } }));
}

/**
 * Inserta o reemplaza por id. Es la DEDUPLICACIÓN clave: mi comentario optimista (id generado
 * en el cliente) vuelve por Realtime con el MISMO id → se reemplaza, no se duplica.
 */
function mergeComment(postId: string, comment: Comment): void {
  setPostComments(postId, (list) => {
    const i = list.findIndex((c) => c.id === comment.id);
    if (i === -1) return [...list, comment];
    const copy = [...list];
    copy[i] = comment;
    return copy;
  });
}

export async function loadComments(postId: string): Promise<void> {
  const remote = await commentRepository.getComments(postId);
  // Conservar los locales pendientes/fallidos que el servidor aún no tiene.
  setPostComments(postId, (local) => {
    const serverIds = new Set(remote.map((c) => c.id));
    return [...remote, ...local.filter((c) => c.syncState && !serverIds.has(c.id))];
  });
}

export function subscribeToComments(postId: string): () => void {
  return commentRepository.subscribe(postId, (comment) => {
    const existed = (useComments.getState().byPost[postId] ?? []).some((c) => c.id === comment.id);
    mergeComment(postId, comment);
    if (!existed) bumpCommentCount(postId, 1); // comentario de OTRA persona en vivo
  });
}

/** UI optimista: el comentario aparece en el acto y se encola para el servidor. */
export async function addComment(postId: string, body: string, parentId: string | null): Promise<void> {
  const me = useSession.getState().profile;
  if (!me || !body.trim()) return;
  const comment: Comment = {
    id: newId(), postId, authorId: me.id, authorUsername: me.username, authorAvatarUrl: me.avatarUrl,
    parentId, body: body.trim(), createdAt: new Date().toISOString(), syncState: 'pending',
  };
  mergeComment(postId, comment);
  bumpCommentCount(postId, 1);
  await syncQueue.enqueue({
    type: 'ADD_COMMENT',
    payload: { id: comment.id, postId, parentId, body: comment.body },
  });
}

function setSyncState(postId: string, id: string, syncState: Comment['syncState']): void {
  setPostComments(postId, (list) => list.map((c) => (c.id === id ? { ...c, syncState } : c)));
}

syncQueue.onOperationCompleted((op) => {
  if (op.type === 'ADD_COMMENT') setSyncState(op.payload.postId, op.payload.id, undefined);
});

syncQueue.onPermanentFailure((op) => {
  if (op.type === 'ADD_COMMENT') setSyncState(op.payload.postId, op.payload.id, 'failed');
});
