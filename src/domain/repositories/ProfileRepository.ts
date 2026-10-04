import type { FollowStatus, Profile, ProfileStats } from '../entities/Profile';

// Editar el perfil y responder solicitudes NO están aquí: son escrituras que van por la
// cola offline (operaciones UPDATE_PROFILE y RESPOND_FOLLOW_REQUEST de SyncOperation).
export interface ProfileRepository {
  getById(id: string): Promise<Profile | null>;
  isUsernameAvailable(username: string): Promise<boolean>;
  search(query: string): Promise<Profile[]>;
  getStats(id: string): Promise<ProfileStats>;
  uploadAvatar(id: string, localUri: string): Promise<string>;

  // --- Seguidores ---
  getFollowStatus(targetId: string): Promise<FollowStatus>;
  /** Devuelve el estado que decidió el SERVIDOR (pending si la cuenta es privada). */
  follow(targetId: string): Promise<FollowStatus>;
  /** Deja de seguir o cancela una solicitud pendiente. */
  unfollow(targetId: string): Promise<void>;
  getFollowers(userId: string): Promise<Profile[]>;
  getFollowing(userId: string): Promise<Profile[]>;
  getPendingRequests(): Promise<Profile[]>;
  /** Tiempo real: avisa cuando llega una nueva solicitud de seguimiento. */
  subscribeToRequests(myId: string, onChange: () => void): () => void;
}
