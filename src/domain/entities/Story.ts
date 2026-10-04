export interface Story {
  id: string;
  authorId: string;
  username: string;
  avatarUrl: string | null;
  imagePath: string;
  /** Historia creada offline que aún no sube: se muestra desde el archivo local. */
  localImageUri?: string;
  createdAt: string;
  expiresAt: string;
  pending?: boolean;
}

/** Historias de UN autor, en orden cronológico (como se reproducen). */
export interface StoryGroup {
  authorId: string;
  username: string;
  avatarUrl: string | null;
  stories: Story[];
  /** true si ya vi TODAS (anillo gris). Se calcula con el estado "visto" LOCAL. */
  allSeen: boolean;
}

export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export function isExpired(story: Story, now = Date.now()): boolean {
  return new Date(story.expiresAt).getTime() <= now;
}

/**
 * Agrupa por autor y ordena la bandeja de historias como Instagram:
 *   1. Mi historia primero (si tengo).
 *   2. Autores con historias SIN VER.
 *   3. Autores ya vistos.
 * Dentro de cada grupo, de la más reciente a la más vieja según su última historia.
 * Función PURA: recibe datos y devuelve datos.
 */
export function groupStories(stories: Story[], seen: Set<string>, myId: string | null, now = Date.now()): StoryGroup[] {
  const byAuthor = new Map<string, Story[]>();
  for (const s of stories) {
    if (isExpired(s, now)) continue; // por si la app quedó abierta pasadas las 24 h
    const list = byAuthor.get(s.authorId) ?? [];
    list.push(s);
    byAuthor.set(s.authorId, list);
  }

  const groups: StoryGroup[] = [...byAuthor.values()].map((list) => {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const first = list[0];
    return {
      authorId: first.authorId,
      username: first.username,
      avatarUrl: first.avatarUrl,
      stories: list,
      allSeen: list.every((s) => seen.has(s.id)),
    };
  });

  const latest = (g: StoryGroup) => g.stories[g.stories.length - 1].createdAt;
  return groups.sort((a, b) => {
    if (a.authorId === myId) return -1;
    if (b.authorId === myId) return 1;
    if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1;
    return latest(b).localeCompare(latest(a));
  });
}

export interface StoryPosition {
  group: number;
  story: number;
  /** Se terminaron todas las historias → cerrar el visor. */
  done: boolean;
}

/**
 * Navegación del visor (función PURA, sin estado ni efectos):
 *  +1: siguiente historia del mismo autor; al terminar, primera del siguiente autor; al final, done.
 *  -1: historia anterior; desde la primera, primera del autor anterior; desde la primera de todas, se queda.
 */
export function stepStory(groups: StoryGroup[], pos: StoryPosition, dir: 1 | -1): StoryPosition {
  const current = groups[pos.group];
  if (!current) return { ...pos, done: true };
  if (dir === 1) {
    if (pos.story < current.stories.length - 1) return { ...pos, story: pos.story + 1 };
    if (pos.group < groups.length - 1) return { group: pos.group + 1, story: 0, done: false };
    return { ...pos, done: true };
  }
  if (pos.story > 0) return { ...pos, story: pos.story - 1 };
  if (pos.group > 0) return { group: pos.group - 1, story: 0, done: false };
  return pos;
}

/** La historia que viene después de `pos` (para precargar su imagen). */
export function peekNext(groups: StoryGroup[], pos: StoryPosition): Story | null {
  const next = stepStory(groups, pos, 1);
  return next.done ? null : (groups[next.group]?.stories[next.story] ?? null);
}

/** Índice de la primera historia no vista del grupo (para retomar donde se quedó). */
export function firstUnseenIndex(group: StoryGroup, seen: Set<string>): number {
  const i = group.stories.findIndex((s) => !seen.has(s.id));
  return i === -1 ? 0 : i;
}
