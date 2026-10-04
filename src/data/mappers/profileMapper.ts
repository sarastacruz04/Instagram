import type { Profile } from '@/domain/entities/Profile';

// Forma exacta de la fila en Postgres (snake_case). Solo la capa de datos la conoce.
export interface ProfileRow {
  id: string;
  username: string;
  full_name: string;
  bio: string;
  avatar_url: string | null;
  is_private: boolean;
}

export const PROFILE_COLUMNS = 'id, username, full_name, bio, avatar_url, is_private';

export function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    isPrivate: row.is_private,
  };
}
