import type { ActivityItem, Comment, Post } from '../entities/Post';

export interface Page<T> {
  items: T[];
  /** Cursor para la siguiente página (created_at del último), o null si no hay más. */
  nextCursor: string | null;
  /** true si los datos vienen del caché local porque no hubo red. */
  fromCache?: boolean;
}

export interface PostRepository {
  getFeed(cursor: string | null): Promise<Page<Post>>;
  getExplore(cursor: string | null): Promise<Page<Post>>;
  getUserPosts(userId: string, cursor: string | null): Promise<Page<Post>>;
  getPost(id: string): Promise<Post | null>;
  /** Copia la imagen a almacenamiento persistente (sobrevive a cierres) para la subida diferida. */
  persistPendingImage(postId: string, sourceUri: string): Promise<string>;
}

export interface CommentRepository {
  getComments(postId: string): Promise<Comment[]>;
  /** Suscripción en tiempo real a comentarios nuevos del post. Devuelve la función para cancelar. */
  subscribe(postId: string, onInsert: (comment: Comment) => void): () => void;
}

export interface ActivityRepository {
  getActivity(): Promise<ActivityItem[]>;
}
