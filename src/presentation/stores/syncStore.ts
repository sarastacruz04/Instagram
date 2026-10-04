import { create } from 'zustand';

import { syncQueue } from '@/di/container';
import type { SyncStatus } from '@/domain/repositories/SyncQueue';

// Puente entre el motor (capa data, sin React) y la UI. El motor emite eventos;
// este store los convierte en estado reactivo que los componentes leen con selectores.
export const useSyncStatus = create<SyncStatus>(() => ({
  online: true,
  pending: 0,
  failed: 0,
  syncing: false,
}));

syncQueue.onStatusChange((status) => useSyncStatus.setState(status));
