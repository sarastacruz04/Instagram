// Operaciones que el usuario puede hacer sin conexión. Es una UNIÓN DISCRIMINADA:
// el campo `type` le dice a TypeScript qué forma tiene `payload`, así el motor
// de sincronización no puede ejecutar una operación con datos del tipo equivocado.
//
// Cada operación describe una INTENCIÓN serializable (JSON), no una llamada HTTP:
// se guarda en SQLite y puede ejecutarse minutos u horas después.
export type SyncOperation =
  | {
      type: 'SET_LIKE';
      // Estado deseado ("quiero que quede en true"), no un toggle. Dos reintentos
      // del mismo SET_LIKE dan el mismo resultado → idempotente.
      payload: { postId: string; liked: boolean };
    }
  | {
      type: 'ADD_COMMENT';
      // `id` lo genera el cliente: si el reintento llega dos veces, el servidor lo ignora.
      payload: { id: string; postId: string; parentId: string | null; body: string };
    }
  | {
      type: 'CREATE_POST';
      // localUri apunta a una copia PERSISTENTE de la imagen (documentos de la app), no al caché:
      // el SO puede borrar el caché antes de que vuelva la red.
      payload: { id: string; localUri: string; caption: string };
    }
  | {
      type: 'CREATE_STORY';
      payload: { id: string; localUri: string };
    }
  | {
      type: 'SEND_MESSAGE';
      // Mismo principio: id del cliente → el reintento no duplica el mensaje.
      payload: { id: string; conversationId: string; body: string };
    };

export type SyncOperationType = SyncOperation['type'];

/** Operación leída de la cola, con sus metadatos de persistencia. */
export interface QueuedOperation {
  id: number;
  operation: SyncOperation;
  createdAt: number;
  attempts: number;
}

/**
 * Clave de coalescencia: operaciones de ESTADO sobre el mismo recurso se pueden
 * fusionar (solo importa la última intención). Las de CREACIÓN (comentarios) no.
 */
export function coalesceKeyOf(op: SyncOperation): string | null {
  switch (op.type) {
    case 'SET_LIKE':
      return `like:${op.payload.postId}`;
    default:
      return null;
  }
}
