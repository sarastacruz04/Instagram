// Entidad de dominio: TypeScript puro. No conoce Supabase, SQLite ni React.
// Si mañana cambiamos de backend, esta capa no se toca.
export interface Profile {
  id: string;
  username: string;
  fullName: string;
  bio: string;
  avatarUrl: string | null;
  isPrivate: boolean;
}

// Relación del usuario actual con otro perfil.
export type FollowStatus = 'none' | 'pending' | 'accepted';

export interface ProfileStats {
  posts: number;
  followers: number;
  following: number;
}

/**
 * ¿Puedo ver el contenido de este perfil? Es la MISMA regla que can_view() en Postgres.
 * Aquí solo decide qué mostrar (candado vs grilla); la garantía real es RLS en el servidor.
 */
export function canViewContent(profile: Profile, myId: string | null, status: FollowStatus): boolean {
  return profile.id === myId || !profile.isPrivate || status === 'accepted';
}
