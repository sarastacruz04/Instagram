import { create } from 'zustand';

import { authRepository, profileRepository, syncEngine } from '@/di/container';
import type { Profile } from '@/domain/entities/Profile';

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
    const profile = await profileRepository.getById(userId);
    // Evita una carrera: si la sesión cambió mientras esperábamos la red, se descarta el resultado.
    if (useSession.getState().userId === userId) useSession.setState({ profile });
  } catch {
    // Sin red: seguimos con el perfil anterior. La UI no depende de él para navegar.
  }
}
