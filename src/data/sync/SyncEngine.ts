import { AppState } from 'react-native';

import { subscribeToConnectivity } from '@/core/network/networkMonitor';
import type { SyncFailureListener, SyncQueue, SyncStatus } from '@/domain/repositories/SyncQueue';
import type { SyncOperation } from '@/domain/sync/SyncOperation';

import { outboxDao } from '../local/OutboxDao';
import { executeOperation } from './operationHandlers';
import { classifyError } from './syncErrors';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;

/**
 * Motor de sincronización offline-first (patrón "Transactional Outbox").
 *
 *  UI ──enqueue──▶ SQLite (outbox) ──drain──▶ Supabase
 *
 * Garantías:
 *  1. Durabilidad: la intención se guarda en SQLite ANTES de intentar la red. Si la app
 *     muere o no hay internet, la operación sigue ahí.
 *  2. Orden cronológico estricto: se procesa por id AUTOINCREMENT, de una en una. Si la
 *     primera falla por red, la cola SE DETIENE (no se salta a la siguiente), así "comentar
 *     y luego responder a ese comentario" nunca llega al revés al servidor.
 *  3. Un solo consumidor: `draining` actúa como candado; nunca hay dos drenados en paralelo.
 *
 * Hilos: esta clase corre en el hilo JS, pero todo su trabajo pesado es I/O que se delega a
 * hilos nativos (SQLite y OkHttp). Entre cada `await` el hilo JS queda libre para la UI.
 */
export class SyncEngine implements SyncQueue {
  private userId: string | null = null;
  private online = false;
  private appActive = AppState.currentState === 'active';
  private draining: Promise<void> | null = null;
  private drainRequested = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private status: SyncStatus = { online: false, pending: 0, failed: 0, syncing: false };
  private readonly statusListeners = new Set<(s: SyncStatus) => void>();
  private readonly failureListeners = new Set<SyncFailureListener>();
  private readonly completedListeners = new Set<(op: SyncOperation) => void>();
  private teardown: (() => void)[] = [];

  // ---------------------------------------------------------------- ciclo de vida

  /** Se llama al iniciar sesión. Solo procesa las operaciones de ESTE usuario. */
  async start(userId: string): Promise<void> {
    this.stop();
    this.userId = userId;
    await outboxDao.resetInflight(userId);
    await this.refreshCounts();

    // Disparadores del drenado: recuperar conexión y volver a primer plano.
    this.teardown.push(
      subscribeToConnectivity((online) => {
        this.online = online;
        this.setStatus({ online });
        if (online) {
          this.consecutiveFailures = 0; // la red volvió: no esperar el backoff acumulado
          this.kick();
        }
      }),
    );
    const appStateSub = AppState.addEventListener('change', (state) => {
      this.appActive = state === 'active';
      if (this.appActive) this.kick();
    });
    this.teardown.push(() => appStateSub.remove());
  }

  /** Al cerrar sesión: deja de escuchar. Las operaciones quedan guardadas con su user_id. */
  stop(): void {
    this.teardown.forEach((fn) => fn());
    this.teardown = [];
    this.clearRetryTimer();
    this.userId = null;
  }

  // ---------------------------------------------------------------- API pública (SyncQueue)

  async enqueue(operation: SyncOperation): Promise<void> {
    const userId = this.userId;
    if (!userId) throw new Error('SyncEngine sin sesión');
    await outboxDao.enqueue(userId, operation);
    await this.refreshCounts();
    this.kick();
  }

  onStatusChange(listener: (s: SyncStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  onPermanentFailure(listener: SyncFailureListener): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  async clearFailed(): Promise<void> {
    if (!this.userId) return;
    await outboxDao.clearFailed(this.userId);
    await this.refreshCounts();
  }

  pendingOperations(): Promise<SyncOperation[]> {
    return this.userId ? outboxDao.pending(this.userId) : Promise.resolve([]);
  }

  onOperationCompleted(listener: (op: SyncOperation) => void): () => void {
    this.completedListeners.add(listener);
    return () => this.completedListeners.delete(listener);
  }

  // ---------------------------------------------------------------- drenado

  /**
   * Pide un drenado. Si ya hay uno en curso, solo deja una marca (`drainRequested`) para
   * que al terminar vuelva a revisar. Sin esa marca habría un "wakeup perdido": el drenado
   * actual pudo leer la cola vacía justo ANTES de que se encolara la nueva operación.
   */
  private kick(): void {
    if (!this.userId || !this.online || !this.appActive) return;
    if (this.draining) {
      this.drainRequested = true;
      return;
    }
    this.clearRetryTimer();
    this.drainRequested = false;
    this.draining = this.drain().finally(() => {
      this.draining = null;
      this.setStatus({ syncing: false });
      if (this.drainRequested) this.kick();
    });
  }

  private async drain(): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    this.setStatus({ syncing: true });

    // Se re-verifica en cada vuelta: la red o la sesión pueden cambiar entre dos await.
    while (this.online && this.userId === userId) {
      const next = await outboxDao.nextPending(userId);
      if (!next) break;

      await outboxDao.markInflight(next.id);
      try {
        await executeOperation(next.operation, userId);
        await outboxDao.remove(next.id);
        this.consecutiveFailures = 0;
        this.completedListeners.forEach((l) => l(next.operation));
      } catch (error) {
        const kind = classifyError(error);
        const message = error instanceof Error ? error.message : String(error);

        if (kind === 'duplicate') {
          // Ya estaba aplicada en el servidor: es un éxito.
          await outboxDao.remove(next.id);
          this.completedListeners.forEach((l) => l(next.operation));
        } else if (kind === 'permanent') {
          // Se aparta para no bloquear la cola, y se avisa a la UI para revertir su cambio optimista.
          await outboxDao.markFailed(next.id, message);
          this.failureListeners.forEach((l) => l(next.operation, message));
        } else {
          // Transitorio: vuelve a su posición y la cola SE DETIENE para conservar el orden.
          await outboxDao.markRetry(next.id, message);
          this.scheduleRetry();
          break;
        }
      } finally {
        await this.refreshCounts();
      }
    }
  }

  /**
   * Backoff exponencial con jitter: 1s, 2s, 4s… hasta 60s, ± aleatorio.
   * Evita martillar un servidor caído y que miles de clientes reintenten en el mismo instante.
   */
  private scheduleRetry(): void {
    this.consecutiveFailures += 1;
    const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (this.consecutiveFailures - 1));
    const delay = exp / 2 + Math.random() * (exp / 2);
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.kick();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  // ---------------------------------------------------------------- estado observable

  private async refreshCounts(): Promise<void> {
    if (!this.userId) return;
    const counts = await outboxDao.counts(this.userId);
    this.setStatus(counts);
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.statusListeners.forEach((l) => l(this.status));
  }
}
