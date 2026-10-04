import type { QueuedOperation, SyncOperation } from '@/domain/sync/SyncOperation';
import { coalesceKeyOf } from '@/domain/sync/SyncOperation';

import { getDb, write, writeTransaction } from './database';

// DAO (Data Access Object): único lugar con SQL de la tabla outbox.
interface OutboxRow {
  id: number;
  type: string;
  payload: string;
  attempts: number;
  created_at: number;
}

function toQueued(row: OutboxRow): QueuedOperation {
  return {
    id: row.id,
    operation: { type: row.type, payload: JSON.parse(row.payload) } as SyncOperation,
    createdAt: row.created_at,
    attempts: row.attempts,
  };
}

export const outboxDao = {
  /**
   * Inserta la operación al final de la cola. Si es una operación de ESTADO (like),
   * antes borra las pendientes sobre el mismo recurso: 5 toques al corazón sin red
   * = 1 sola petición con el estado final (coalescencia, "última intención gana").
   * Solo se borran las 'pending': una 'inflight' ya está en camino al servidor.
   */
  async enqueue(userId: string, operation: SyncOperation): Promise<void> {
    const key = coalesceKeyOf(operation);
    await writeTransaction(async (db) => {
      if (key) {
        await db.runAsync(
          `DELETE FROM outbox WHERE user_id = ? AND coalesce_key = ? AND status = 'pending'`,
          userId, key,
        );
      }
      await db.runAsync(
        `INSERT INTO outbox (user_id, type, payload, coalesce_key, created_at) VALUES (?, ?, ?, ?, ?)`,
        userId, operation.type, JSON.stringify(operation.payload), key, Date.now(),
      );
    });
  },

  /** La operación más antigua pendiente. El orden es por id AUTOINCREMENT, no por reloj. */
  async nextPending(userId: string): Promise<QueuedOperation | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<OutboxRow>(
      `SELECT id, type, payload, attempts, created_at FROM outbox
        WHERE user_id = ? AND status = 'pending' ORDER BY id LIMIT 1`,
      userId,
    );
    return row ? toQueued(row) : null;
  },

  markInflight(id: number): Promise<void> {
    return write(async (db) => {
      await db.runAsync(`UPDATE outbox SET status = 'inflight' WHERE id = ?`, id);
    });
  },

  /** Éxito: la operación ya está en el servidor y sale de la cola. */
  remove(id: number): Promise<void> {
    return write(async (db) => {
      await db.runAsync(`DELETE FROM outbox WHERE id = ?`, id);
    });
  },

  /** Fallo transitorio: vuelve a 'pending' en su MISMA posición (conserva su id). */
  markRetry(id: number, error: string): Promise<void> {
    return write(async (db) => {
      await db.runAsync(
        `UPDATE outbox SET status = 'pending', attempts = attempts + 1, last_error = ? WHERE id = ?`,
        error, id,
      );
    });
  },

  /** Fallo permanente: se aparta de la cola ("dead letter") para no bloquear a las demás. */
  markFailed(id: number, error: string): Promise<void> {
    return write(async (db) => {
      await db.runAsync(
        `UPDATE outbox SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?`,
        error, id,
      );
    });
  },

  /**
   * Al arrancar: si la app murió con una operación 'inflight' (se cerró a mitad del envío),
   * no sabemos si llegó al servidor. Se vuelve a 'pending' y se reintenta; como todas las
   * operaciones son idempotentes, reenviarla es seguro aunque ya se hubiera aplicado.
   */
  resetInflight(userId: string): Promise<void> {
    return write(async (db) => {
      await db.runAsync(`UPDATE outbox SET status = 'pending' WHERE user_id = ? AND status = 'inflight'`, userId);
    });
  },

  async counts(userId: string): Promise<{ pending: number; failed: number }> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ pending: number; failed: number }>(
      `SELECT COALESCE(SUM(status IN ('pending','inflight')), 0) AS pending,
              COALESCE(SUM(status = 'failed'), 0)               AS failed
         FROM outbox WHERE user_id = ?`,
      userId,
    );
    return row ?? { pending: 0, failed: 0 };
  },

  async pending(userId: string): Promise<SyncOperation[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<OutboxRow>(
      `SELECT id, type, payload, attempts, created_at FROM outbox
        WHERE user_id = ? AND status IN ('pending', 'inflight') ORDER BY id`,
      userId,
    );
    return rows.map((r) => toQueued(r).operation);
  },

  clearFailed(userId: string): Promise<void> {
    return write(async (db) => {
      await db.runAsync(`DELETE FROM outbox WHERE user_id = ? AND status = 'failed'`, userId);
    });
  },
};
