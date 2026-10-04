import { File } from 'expo-file-system';

import type { FollowStatus, Profile, ProfileStats } from '@/domain/entities/Profile';
import { AppError } from '@/domain/errors';
import type { ProfileRepository, ProfileUpdate } from '@/domain/repositories/ProfileRepository';

import { PROFILE_COLUMNS, toProfile, type ProfileRow } from '../mappers/profileMapper';
import { currentUserId, supabase } from '../remote/supabaseClient';

function fail(error: { message: string } | null, status?: number): void {
  if (!error) return;
  throw new AppError(status === 0 ? 'Sin conexión' : error.message, status === 0 ? 'network' : 'unknown');
}

// Embebe el perfil del otro lado de la relación usando el nombre de la FK.
const FOLLOWER = `follower:profiles!follows_follower_id_fkey(${PROFILE_COLUMNS})`;
const FOLLOWING = `following:profiles!follows_following_id_fkey(${PROFILE_COLUMNS})`;

export class SupabaseProfileRepository implements ProfileRepository {
  async getById(id: string): Promise<Profile | null> {
    const { data, error, status } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', id)
      .maybeSingle<ProfileRow>();
    fail(error, status);
    return data ? toProfile(data) : null;
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    // Solo es una comprobación previa para dar buen feedback. La garantía real
    // es la restricción UNIQUE en Postgres (evita la carrera entre dos registros simultáneos).
    const { count, error, status } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('username', username.toLowerCase());
    fail(error, status);
    return count === 0;
  }

  async search(query: string): Promise<Profile[]> {
    const q = query.trim().toLowerCase().replace(/[%_]/g, ''); // sin comodines inyectados
    if (!q) return [];
    const { data, error, status } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
      .limit(20)
      .returns<ProfileRow[]>();
    fail(error, status);
    return (data ?? []).map(toProfile);
  }

  async getStats(id: string): Promise<ProfileStats> {
    const { data, error, status } = await supabase.rpc('get_profile_stats', { p_user: id }).single<ProfileStats>();
    fail(error, status);
    return data ?? { posts: 0, followers: 0, following: 0 };
  }

  async update(id: string, changes: ProfileUpdate): Promise<void> {
    const row: Record<string, unknown> = {};
    if (changes.fullName !== undefined) row.full_name = changes.fullName;
    if (changes.bio !== undefined) row.bio = changes.bio;
    if (changes.isPrivate !== undefined) row.is_private = changes.isPrivate;
    const { error, status } = await supabase.from('profiles').update(row).eq('id', id);
    fail(error, status);
  }

  async uploadAvatar(id: string, localUri: string): Promise<string> {
    const bytes = await new File(localUri).arrayBuffer();
    const path = `${id}/avatar.jpg`;
    const { error } = await supabase.storage.from('avatars').upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error) throw new AppError(error.message);
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    // Misma ruta, contenido nuevo: el parámetro ?v= cambia la URL para que ninguna caché
    // (la nuestra ni la del CDN) siga mostrando la foto anterior.
    const url = `${data.publicUrl}?v=${Date.now()}`;
    const { error: updateError, status } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', id);
    fail(updateError, status);
    return url;
  }

  // ------------------------------------------------------------------ seguidores

  async getFollowStatus(targetId: string): Promise<FollowStatus> {
    const me = await currentUserId();
    const { data, error, status } = await supabase
      .from('follows')
      .select('status')
      .eq('follower_id', me)
      .eq('following_id', targetId)
      .maybeSingle<{ status: 'pending' | 'accepted' }>();
    fail(error, status);
    return data?.status ?? 'none';
  }

  async follow(targetId: string): Promise<FollowStatus> {
    const me = await currentUserId();
    // No se envía `status`: lo decide el trigger del servidor según la privacidad de la cuenta.
    const { data, error, status } = await supabase
      .from('follows')
      .upsert({ follower_id: me, following_id: targetId }, { onConflict: 'follower_id,following_id', ignoreDuplicates: true })
      .select('status')
      .maybeSingle<{ status: 'pending' | 'accepted' }>();
    fail(error, status);
    return data?.status ?? (await this.getFollowStatus(targetId));
  }

  async unfollow(targetId: string): Promise<void> {
    const me = await currentUserId();
    const { error, status } = await supabase.from('follows').delete().eq('follower_id', me).eq('following_id', targetId);
    fail(error, status);
  }

  async getFollowers(userId: string): Promise<Profile[]> {
    // Si la cuenta es privada y no la sigo, RLS devuelve 0 filas: la lista queda protegida en el servidor.
    const { data, error, status } = await supabase
      .from('follows')
      .select(FOLLOWER)
      .eq('following_id', userId)
      .eq('status', 'accepted')
      .returns<{ follower: ProfileRow }[]>();
    fail(error, status);
    return (data ?? []).map((r) => toProfile(r.follower));
  }

  async getFollowing(userId: string): Promise<Profile[]> {
    const { data, error, status } = await supabase
      .from('follows')
      .select(FOLLOWING)
      .eq('follower_id', userId)
      .eq('status', 'accepted')
      .returns<{ following: ProfileRow }[]>();
    fail(error, status);
    return (data ?? []).map((r) => toProfile(r.following));
  }

  async getPendingRequests(): Promise<Profile[]> {
    const me = await currentUserId();
    const { data, error, status } = await supabase
      .from('follows')
      .select(FOLLOWER)
      .eq('following_id', me)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .returns<{ follower: ProfileRow }[]>();
    fail(error, status);
    return (data ?? []).map((r) => toProfile(r.follower));
  }

  async acceptRequest(followerId: string): Promise<void> {
    const me = await currentUserId();
    // La política follows_update solo permite esto si YO soy la cuenta seguida.
    const { error, status } = await supabase
      .from('follows')
      .update({ status: 'accepted' })
      .eq('follower_id', followerId)
      .eq('following_id', me);
    fail(error, status);
  }

  async rejectRequest(followerId: string): Promise<void> {
    const me = await currentUserId();
    const { error, status } = await supabase.from('follows').delete().eq('follower_id', followerId).eq('following_id', me);
    fail(error, status);
  }

  subscribeToRequests(myId: string, onChange: () => void): () => void {
    const channel = supabase
      .channel(`follow-requests:${myId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follows', filter: `following_id=eq.${myId}` }, onChange)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }
}
