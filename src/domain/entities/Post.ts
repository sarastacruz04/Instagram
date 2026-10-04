export interface Post {
  id: string;
  authorId: string;
  authorUsername: string;
  authorAvatarUrl: string | null;
  /** Ruta en el bucket privado (llave estable). La URL firmada se resuelve aparte y caduca. */
  imagePath: string;
  /** Solo en posts creados offline que aún no suben: archivo local para mostrarlos ya. */
  localImageUri?: string;
  caption: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  createdAt: string;
  /** true mientras el post espera en la cola offline (UI optimista). */
  pending?: boolean;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  authorUsername: string;
  authorAvatarUrl: string | null;
  parentId: string | null;
  body: string;
  createdAt: string;
  /** 'pending' = en la cola offline; 'failed' = el servidor lo rechazó. */
  syncState?: 'pending' | 'failed';
}

export interface ActivityItem {
  kind: 'like' | 'comment';
  actorId: string;
  username: string;
  avatarUrl: string | null;
  postId: string;
  imagePath: string;
  body: string | null;
  createdAt: string;
}
