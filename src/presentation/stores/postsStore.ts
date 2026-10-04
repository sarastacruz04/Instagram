import { Alert } from 'react-native';
import { create } from 'zustand';

import { newId } from '@/core/ids';
import { postRepository, syncQueue } from '@/di/container';
import type { Post } from '@/domain/entities/Post';
import type { Page } from '@/domain/repositories/PostRepository';
import { applyPendingIntents, pendingPostsFrom } from '@/domain/sync/reconcile';

import { useSession } from './sessionStore';

// ESTADO NORMALIZADO (como una base de datos en memoria):
//   byId   → cada post existe UNA sola vez.
//   lists  → cada lista (feed, explorar, perfil de X) guarda solo ids + su paginación.
// Un like en el feed actualiza byId[postId] y TODAS las pantallas que muestran ese post
// (detalle, grilla de perfil) lo ven al instante, sin copias desincronizadas.
export interface ListState {
  ids: string[];
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
  refreshing: boolean;
  fromCache: boolean;
  error: string | null;
}

interface PostsState {
  byId: Record<string, Post>;
  lists: Record<string, ListState>;
}

export const EMPTY_LIST: ListState = {
  ids: [], cursor: null, hasMore: true, loading: false, refreshing: false, fromCache: false, error: null,
};

export const usePosts = create<PostsState>(() => ({ byId: {}, lists: {} }));

export const feedKey = 'feed';
export const exploreKey = 'explore';
export const userKey = (userId: string) => `user:${userId}`;

function fetcherFor(key: string): (cursor: string | null) => Promise<Page<Post>> {
  if (key === feedKey) return (c) => postRepository.getFeed(c);
  if (key === exploreKey) return (c) => postRepository.getExplore(c);
  const userId = key.slice('user:'.length);
  return (c) => postRepository.getUserPosts(userId, c);
}

function patchList(key: string, patch: Partial<ListState>): void {
  usePosts.setState((s) => ({
    lists: { ...s.lists, [key]: { ...(s.lists[key] ?? EMPTY_LIST), ...patch } },
  }));
}

function patchPost(id: string, patch: Partial<Post>): void {
  usePosts.setState((s) => {
    const post = s.byId[id];
    return post ? { byId: { ...s.byId, [id]: { ...post, ...patch } } } : s;
  });
}

function upsertPosts(posts: Post[]): void {
  usePosts.setState((s) => {
    const byId = { ...s.byId };
    for (const p of posts) byId[p.id] = p;
    return { byId };
  });
}

// ------------------------------------------------------------------ carga de listas

/** Primera página (refresh) o siguiente página (more) de una lista, con paginación por cursor. */
export async function loadList(key: string, mode: 'refresh' | 'more'): Promise<void> {
  const list = usePosts.getState().lists[key] ?? EMPTY_LIST;
  // Evita peticiones duplicadas: onEndReached puede dispararse varias veces seguidas.
  if (list.loading || list.refreshing) return;
  if (mode === 'more' && (!list.hasMore || !list.cursor)) return;

  patchList(key, mode === 'refresh' ? { refreshing: true, error: null } : { loading: true, error: null });
  try {
    const page = await fetcherFor(key)(mode === 'refresh' ? null : list.cursor);

    // Reconciliar con la cola: la intención local pendiente gana sobre la foto del servidor.
    const pending = await syncQueue.pendingOperations();
    let items = applyPendingIntents(page.items, pending);
    const me = useSession.getState().profile;
    if (mode === 'refresh' && me && (key === feedKey || key === userKey(me.id))) {
      const drafts = pendingPostsFrom(pending, me).filter((d) => !items.some((p) => p.id === d.id));
      items = [...drafts, ...items];
    }

    upsertPosts(items);
    const ids = items.map((p) => p.id);
    const current = usePosts.getState().lists[key] ?? EMPTY_LIST;
    patchList(key, {
      ids: mode === 'refresh' ? ids : [...current.ids, ...ids.filter((id) => !current.ids.includes(id))],
      cursor: page.nextCursor,
      hasMore: page.nextCursor !== null,
      fromCache: page.fromCache ?? false,
      loading: false,
      refreshing: false,
    });
  } catch (e) {
    patchList(key, { loading: false, refreshing: false, error: (e as Error).message });
  }
}

/** Carga un post suelto (deep link / detalle) si no está ya en memoria. */
export async function ensurePost(id: string): Promise<Post | null> {
  const cached = usePosts.getState().byId[id];
  if (cached) return cached;
  const post = await postRepository.getPost(id);
  if (post) upsertPosts(applyPendingIntents([post], await syncQueue.pendingOperations()));
  return post;
}

// ------------------------------------------------------------------ acciones optimistas

/**
 * UI OPTIMISTA: 1) cambia el estado en memoria YA (el corazón se pinta en el mismo frame),
 * 2) encola la intención en SQLite. La red ocurre después, en el SyncEngine.
 * Latencia percibida: 0 ms, con o sin internet.
 */
export function toggleLike(postId: string): void {
  const post = usePosts.getState().byId[postId];
  if (!post || post.pending) return; // un post que aún no existe en el servidor no se puede likear
  const liked = !post.likedByMe;
  patchPost(postId, { likedByMe: liked, likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)) });
  syncQueue.enqueue({ type: 'SET_LIKE', payload: { postId, liked } }).catch(() => {
    // Ni siquiera se pudo guardar en SQLite (muy raro): revertir.
    revertLike(postId, liked);
  });
}

function revertLike(postId: string, failedIntent: boolean): void {
  const post = usePosts.getState().byId[postId];
  // Solo revertir si el estado actual sigue siendo el de la intención fallida.
  // Si el usuario ya volvió a tocar el corazón, su intención más nueva manda.
  if (!post || post.likedByMe !== failedIntent) return;
  patchPost(postId, {
    likedByMe: !failedIntent,
    likeCount: Math.max(0, post.likeCount + (failedIntent ? -1 : 1)),
  });
}

export function bumpCommentCount(postId: string, delta: number): void {
  const post = usePosts.getState().byId[postId];
  if (post) patchPost(postId, { commentCount: Math.max(0, post.commentCount + delta) });
}

/** Crear post: aparece en el feed al instante (con la imagen local) y se sube cuando haya red. */
export async function createPost(localUri: string, caption: string): Promise<void> {
  const me = useSession.getState().profile;
  if (!me) throw new Error('Perfil no cargado');
  const id = newId();
  const persistedUri = await postRepository.persistPendingImage(id, localUri);

  const draft: Post = {
    id, authorId: me.id, authorUsername: me.username, authorAvatarUrl: me.avatarUrl,
    imagePath: '', localImageUri: persistedUri, caption, likeCount: 0, commentCount: 0,
    likedByMe: false, createdAt: new Date().toISOString(), pending: true,
  };
  upsertPosts([draft]);
  for (const key of [feedKey, userKey(me.id)]) {
    const list = usePosts.getState().lists[key] ?? EMPTY_LIST;
    patchList(key, { ids: [id, ...list.ids] });
  }
  await syncQueue.enqueue({ type: 'CREATE_POST', payload: { id, localUri: persistedUri, caption } });
}

function removePostEverywhere(id: string): void {
  usePosts.setState((s) => {
    const byId = { ...s.byId };
    delete byId[id];
    const lists: Record<string, ListState> = {};
    for (const [k, l] of Object.entries(s.lists)) lists[k] = { ...l, ids: l.ids.filter((x) => x !== id) };
    return { byId, lists };
  });
}

// ------------------------------------------------------------------ eventos del motor

// Confirmación del servidor: el borrador del post se reemplaza por la versión real.
syncQueue.onOperationCompleted(async (op) => {
  if (op.type !== 'CREATE_POST') return;
  try {
    const real = await postRepository.getPost(op.payload.id);
    if (real) upsertPosts([real]);
  } catch {
    patchPost(op.payload.id, { pending: false });
  }
});

// Rechazo definitivo del servidor → ROLLBACK del cambio optimista.
syncQueue.onPermanentFailure((op, reason) => {
  switch (op.type) {
    case 'SET_LIKE':
      revertLike(op.payload.postId, op.payload.liked);
      break;
    case 'ADD_COMMENT':
      bumpCommentCount(op.payload.postId, -1);
      break;
    case 'CREATE_POST':
      removePostEverywhere(op.payload.id);
      Alert.alert('No se pudo publicar', reason);
      break;
  }
});
