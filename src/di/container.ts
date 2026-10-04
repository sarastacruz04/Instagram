// Composition root: el ÚNICO lugar que conoce las implementaciones concretas.
// El resto de la app importa estas instancias tipadas como interfaces de dominio.
// Para tests o para cambiar Supabase por otro backend, solo se cambia este archivo.
import type { ImageCache } from '@/core/cache/ImageCache';
import { ImageCacheEngine } from '@/data/imageCache/ImageCacheEngine';
import { SupabaseActivityRepository } from '@/data/repositories/SupabaseActivityRepository';
import { SupabaseAuthRepository } from '@/data/repositories/SupabaseAuthRepository';
import { SupabaseCommentRepository } from '@/data/repositories/SupabaseCommentRepository';
import { SupabaseDirectMessageRepository } from '@/data/repositories/SupabaseDirectMessageRepository';
import { SupabaseMediaRepository } from '@/data/repositories/SupabaseMediaRepository';
import { SupabasePostRepository } from '@/data/repositories/SupabasePostRepository';
import { SupabaseProfileRepository } from '@/data/repositories/SupabaseProfileRepository';
import { SupabaseStoryRepository } from '@/data/repositories/SupabaseStoryRepository';
import { SyncEngine } from '@/data/sync/SyncEngine';
import type { AuthRepository } from '@/domain/repositories/AuthRepository';
import type { DirectMessageRepository } from '@/domain/repositories/DirectMessageRepository';
import type { MediaRepository } from '@/domain/repositories/MediaRepository';
import type { ActivityRepository, CommentRepository, PostRepository } from '@/domain/repositories/PostRepository';
import type { ProfileRepository } from '@/domain/repositories/ProfileRepository';
import type { StoryRepository } from '@/domain/repositories/StoryRepository';
import type { SyncQueue } from '@/domain/repositories/SyncQueue';

export const authRepository: AuthRepository = new SupabaseAuthRepository();
export const profileRepository: ProfileRepository = new SupabaseProfileRepository();
export const postRepository: PostRepository = new SupabasePostRepository();
export const commentRepository: CommentRepository = new SupabaseCommentRepository();
export const activityRepository: ActivityRepository = new SupabaseActivityRepository();
export const mediaRepository: MediaRepository = new SupabaseMediaRepository();
export const dmRepository: DirectMessageRepository = new SupabaseDirectMessageRepository();
export const storyRepository: StoryRepository = new SupabaseStoryRepository();

// Un solo motor de caché para toda la app: una única LRU en RAM y un único índice en disco.
export const imageCache: ImageCache = new ImageCacheEngine();

// Una sola instancia (singleton) del motor: un único consumidor de la cola en todo el proceso.
// `syncEngine` expone el ciclo de vida (start/stop) solo al bootstrap de sesión;
// el resto de la app ve únicamente la interfaz `SyncQueue`.
export const syncEngine = new SyncEngine();
export const syncQueue: SyncQueue = syncEngine;
