import { Alert } from 'react-native';
import { create } from 'zustand';

import { newId } from '@/core/ids';
import { storyRepository, syncQueue } from '@/di/container';
import { groupStories, STORY_TTL_MS, type Story, type StoryGroup } from '@/domain/entities/Story';

import { useSession } from './sessionStore';

interface StoriesState {
  stories: Story[];
  /** Ids de historias vistas EN ESTE DISPOSITIVO (espejo en memoria de la tabla story_seen). */
  seen: Record<string, true>;
  /**
   * Grupos ya calculados. Se guardan en el estado (no se calculan en un selector) porque
   * un selector que devuelve un arreglo NUEVO en cada llamada haría que Zustand detecte
   * "cambio" en cada render y re-renderice sin fin.
   */
  groups: StoryGroup[];
  loaded: boolean;
}

export const useStories = create<StoriesState>(() => ({ stories: [], seen: {}, groups: [], loaded: false }));

function recompute(stories: Story[], seen: Record<string, true>): StoryGroup[] {
  return groupStories(stories, new Set(Object.keys(seen)), useSession.getState().userId);
}

function setStories(stories: Story[]): void {
  useStories.setState((s) => ({ stories, groups: recompute(stories, s.seen), loaded: true }));
}

export async function loadStories(): Promise<void> {
  try {
    await storyRepository.purgeExpiredSeen(); // las marcas de historias vencidas ya no sirven
    const [remote, seenIds, pending] = await Promise.all([
      storyRepository.getStoryFeed(),
      storyRepository.getSeenIds(),
      syncQueue.pendingOperations(),
    ]);
    const seen: Record<string, true> = {};
    seenIds.forEach((id) => (seen[id] = true));
    useStories.setState({ seen });

    // Historias creadas sin red que siguen en la cola: visibles como "mi historia".
    const me = useSession.getState().profile;
    const drafts: Story[] = me
      ? pending
          .filter((op) => op.type === 'CREATE_STORY')
          .map((op) => op.payload as { id: string; localUri: string })
          .filter((p) => !remote.some((s) => s.id === p.id))
          .map((p) => draftStory(p.id, p.localUri, me))
      : [];
    setStories([...remote, ...drafts]);
  } catch {
    useStories.setState({ loaded: true });
  }
}

function draftStory(id: string, localUri: string, me: { id: string; username: string; avatarUrl: string | null }): Story {
  const now = Date.now();
  return {
    id, authorId: me.id, username: me.username, avatarUrl: me.avatarUrl, imagePath: '',
    localImageUri: localUri, createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + STORY_TTL_MS).toISOString(), pending: true,
  };
}

/** Marca "visto" LOCAL: en memoria al instante y persistido en SQLite (hilo nativo). */
export function markStorySeen(story: Story): void {
  if (useStories.getState().seen[story.id]) return;
  useStories.setState((s) => {
    const seen = { ...s.seen, [story.id]: true as const };
    return { seen, groups: recompute(s.stories, seen) };
  });
  void storyRepository.markSeen(story.id, story.expiresAt).catch(() => {});
}

/** Publicar historia: visible al instante (imagen local) y subida por la cola offline. */
export async function createStory(localUri: string): Promise<void> {
  const me = useSession.getState().profile;
  if (!me) return;
  const id = newId();
  const persisted = await storyRepository.persistPendingImage(id, localUri);
  setStories([...useStories.getState().stories, draftStory(id, persisted, me)]);
  await syncQueue.enqueue({ type: 'CREATE_STORY', payload: { id, localUri: persisted } });
}

syncQueue.onOperationCompleted((op) => {
  if (op.type === 'CREATE_STORY') void loadStories(); // reemplaza el borrador por la historia real
});

syncQueue.onPermanentFailure((op, reason) => {
  if (op.type !== 'CREATE_STORY') return;
  setStories(useStories.getState().stories.filter((s) => s.id !== op.payload.id));
  Alert.alert('No se pudo publicar la historia', reason);
});
