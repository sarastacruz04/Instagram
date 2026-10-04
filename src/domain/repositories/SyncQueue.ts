import type { SyncOperation } from '../sync/SyncOperation';

export interface SyncStatus {
  online: boolean;
  /** Operaciones esperando a ser enviadas. */
  pending: number;
  /** Operaciones que el servidor rechazó de forma definitiva. */
  failed: number;
  syncing: boolean;
}

export type SyncFailureListener = (operation: SyncOperation, reason: string) => void;

// Contrato que usa la capa de presentación para las acciones offline-first.
// La UI solo sabe "encola esta intención"; no sabe de SQLite, reintentos ni red.
export interface SyncQueue {
  enqueue(operation: SyncOperation): Promise<void>;
  onStatusChange(listener: (status: SyncStatus) => void): () => void;
  /** Avisa cuando el servidor rechaza una operación → la UI hace rollback de su cambio optimista. */
  onPermanentFailure(listener: SyncFailureListener): () => void;
  /** Descarta las operaciones rechazadas definitivamente (dead letters). */
  clearFailed(): Promise<void>;
  /** Operaciones aún no confirmadas por el servidor, en orden cronológico (para reconciliar). */
  pendingOperations(): Promise<SyncOperation[]>;
  /** Avisa cuando una operación se confirmó en el servidor. */
  onOperationCompleted(listener: (operation: SyncOperation) => void): () => void;
}
