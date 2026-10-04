import type { ActivityItem, Comment, Post } from '@/domain/entities/Post';

// Forma de fila que devuelven get_feed / get_post / get_user_posts / get_explore.
export interface PostRow {
  id: string;
  author_id: string;
  image_path: string;
  caption: string;
  like_count: number;
  comment_count: number;
  created_at: string;
  username: string;
  avatar_url: string | null;
  liked_by_me: boolean;
}

export function toPost(row: PostRow): Post {
  return {
    id: row.id,
    authorId: row.author_id,
    authorUsername: row.username,
    authorAvatarUrl: row.avatar_url,
    imagePath: row.image_path,
    caption: row.caption,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    likedByMe: row.liked_by_me,
    createdAt: row.created_at,
  };
}

export interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  author: { username: string; avatar_url: string | null } | null;
}

export const COMMENT_COLUMNS =
  'id, post_id, author_id, parent_id, body, created_at, author:profiles!comments_author_id_fkey(username, avatar_url)';

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    postId: row.post_id,
    authorId: row.author_id,
    authorUsername: row.author?.username ?? '',
    authorAvatarUrl: row.author?.avatar_url ?? null,
    parentId: row.parent_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

export interface ActivityRow {
  kind: 'like' | 'comment';
  actor_id: string;
  username: string;
  avatar_url: string | null;
  post_id: string;
  image_path: string;
  body: string | null;
  created_at: string;
}

export function toActivity(row: ActivityRow): ActivityItem {
  return {
    kind: row.kind,
    actorId: row.actor_id,
    username: row.username,
    avatarUrl: row.avatar_url,
    postId: row.post_id,
    imagePath: row.image_path,
    body: row.body,
    createdAt: row.created_at,
  };
}
