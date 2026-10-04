import { Alert } from 'react-native';
import { create } from 'zustand';

import { authRepository, profileRepository, syncEngine, syncQueue } from '@/di/container';
import type { Profile } from '@/domain/entities/Profile';
import { applyPendingProfile } from '@/domain/sync/reconcile';

// Estado GLOBAL de sesión. Zustand guarda el estado fuera del árbol de React:
// cualquier módulo (p. ej. el motor de sincronización) puede leerlo con getState()
// sin ser un componente. Los componentes se suscriben con selectores y solo
// se re-renderizan si cambia el trozo de estado que seleccionan.
type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

interface SessionState {
  status: SessionStatus;
  userId: string | null;
  profile: Profile | null;
}

export const useSession = create<SessionState>(() => ({
  status: 'loading',
  userId: null,
  profile: null,
}));

let started = false;

/** Se llama una vez al arrancar la app. Escucha la sesión durante toda la vida del proceso. */
export function bootstrapSession(): void {
  if (started) return; // idempotente: StrictMode monta los efectos dos veces en desarrollo
  started = true;

  authRepository.onAuthStateChange(async (userId) => {
    if (!userId) {
      syncEngine.stop();
      useSession.setState({ status: 'signedOut', userId: null, profile: null });
      return;
    }
    // TOKEN_REFRESHED también llega aquí con el mismo usuario: no reiniciar el motor por eso.
    if (useSession.getState().userId !== userId) {
      void syncEngine.start(userId);
    }
    useSession.setState({ status: 'signedIn', userId });
    await refreshMyProfile();
  });
}

export async function refreshMyProfile(): Promise<void> {
  const { userId } = useSession.getState();
  if (!userId) return;
  try {
    const remote = await profileRepository.getById(userId);
    // Reconciliar: si hay una edición del perfil todavía en la cola, el servidor aún no la
    // tiene; se aplica encima para no "deshacer" visualmente lo que el usuario guardó.
    const profile = remote ? applyPendingProfile(remote, await syncQueue.pendingOperations()) : null;
    // Evita una carrera: si la sesión cambió mientras esperábamos la red, se descarta el resultado.
    if (useSession.getState().userId === userId) useSession.setState({ profile });
  } catch {
    // Sin red: seguimos con el perfil anterior. La UI no depende de él para navegar.
  }
}

/**
 * Editar perfil OPTIMISTA: el perfil cambia en memoria al instante (la pantalla de perfil
 * lo muestra ya, con o sin red) y la intención se guarda en la cola offline.
 */
export async function updateMyProfile(changes: { fullName: string; bio: string; isPrivate: boolean }): Promise<void> {
  const { profile } = useSession.getState();
  if (!profile) return;
  useSession.setState({ profile: { ...profile, ...changes } });
  await syncQueue.enqueue({ type: 'UPDATE_PROFILE', payload: changes });
}

// Rechazo definitivo del servidor → volver a lo que realmente tiene el servidor.
syncQueue.onPermanentFailure((op, reason) => {
  if (op.type !== 'UPDATE_PROFILE') return;
  Alert.alert('No se pudo guardar tu perfil', reason);
  void refreshMyProfile();
});
