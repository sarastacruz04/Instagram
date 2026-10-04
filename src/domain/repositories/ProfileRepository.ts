import type { FollowStatus, Profile, ProfileStats } from '../entities/Profile';

export interface ProfileUpdate {
  fullName?: string;
  bio?: string;
  isPrivate?: boolean;
}

export interface ProfileRepository {
  getById(id: string): Promise<Profile | null>;
  isUsernameAvailable(username: string): Promise<boolean>;
  search(query: string): Promise<Profile[]>;
  getStats(id: string): Promise<ProfileStats>;
  update(id: string, changes: ProfileUpdate): Promise<void>;
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
  acceptRequest(followerId: string): Promise<void>;
  rejectRequest(followerId: string): Promise<void>;
  /** Tiempo real: avisa cuando llega una nueva solicitud de seguimiento. */
  subscribeToRequests(myId: string, onChange: () => void): () => void;
}
