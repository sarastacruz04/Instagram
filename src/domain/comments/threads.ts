import type { Comment } from '../entities/Post';

export interface CommentRow {
  comment: Comment;
  depth: 0 | 1;
}

/**
 * Convierte la lista plana (como viene de la BD) en hilos: cada comentario raíz seguido de sus
 * respuestas. Modelo de Instagram: UN nivel de anidación; responder a una respuesta cuelga del
 * mismo comentario raíz (ver rootIdOf). Orden cronológico dentro de cada nivel.
 * O(n log n) por el ordenamiento; el agrupado es O(n) con un Map.
 */
export function buildThreads(comments: Comment[]): CommentRow[] {
  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const replies = new Map<string, Comment[]>();
  const roots: Comment[] = [];
  const ids = new Set(sorted.map((c) => c.id));

  for (const c of sorted) {
    // Una respuesta cuyo padre no está cargado se muestra como raíz para no perderla.
    if (c.parentId && ids.has(c.parentId)) {
      const list = replies.get(c.parentId) ?? [];
      list.push(c);
      replies.set(c.parentId, list);
    } else {
      roots.push(c);
    }
  }

  const rows: CommentRow[] = [];
  for (const root of roots) {
    rows.push({ comment: root, depth: 0 });
    for (const reply of replies.get(root.id) ?? []) rows.push({ comment: reply, depth: 1 });
  }
  return rows;
}

/** Al responder a una respuesta, el padre real es su raíz (un solo nivel de anidación). */
export function rootIdOf(comment: Comment): string {
  return comment.parentId ?? comment.id;
}
