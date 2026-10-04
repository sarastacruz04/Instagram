import { File } from 'expo-file-system';

import type { SyncOperation, SyncOperationType } from '@/domain/sync/SyncOperation';

import { supabase } from '../remote/supabaseClient';
import { ensureOk, ensureStorageOk, RemoteError } from './syncErrors';

// Tipo mapeado: para cada `type` de la unión, un ejecutor que recibe EXACTAMENTE su payload.
// Si mañana se agrega una operación nueva al dominio y no se agrega aquí, TypeScript no compila.
type Handlers = {
  [K in SyncOperationType]: (
    payload: Extract<SyncOperation, { type: K }>['payload'],
    userId: string,
  ) => Promise<void>;
};

// Cada ejecutor es IDEMPOTENTE: ejecutarlo 2 veces deja el servidor igual que 1 vez.
// Es la base para resolver conflictos sin corromper la BD remota cuando hay reintentos.
export const operationHandlers: Handlers = {
  async SET_LIKE({ postId, liked }, userId) {
    if (liked) {
      // INSERT … ON CONFLICT DO NOTHING: si el like ya existe, no pasa nada.
      ensureOk(
        await supabase
          .from('likes')
          .upsert({ post_id: postId, user_id: userId }, { onConflict: 'post_id,user_id', ignoreDuplicates: true }),
      );
    } else {
      // DELETE de algo que no existe = 0 filas afectadas, no es error.
      ensureOk(await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', userId));
    }
  },

  async ADD_COMMENT({ id, postId, parentId, body }, userId) {
    ensureOk(
      await supabase
        .from('comments')
        .upsert(
          { id, post_id: postId, parent_id: parentId, author_id: userId, body },
          { onConflict: 'id', ignoreDuplicates: true },
        ),
    );
  },

  async CREATE_POST({ id, localUri, caption }, userId) {
    const file = new File(localUri);
    if (!file.exists) {
      // Sin la imagen local no hay forma de completar la operación: error permanente.
      throw new RemoteError('La imagen local ya no existe', 'LOCAL_FILE_MISSING', 400);
    }
    // Paso 1: subir la imagen. La ruta es fija (depende del id del post) y upsert=true:
    // si el reintento repite la subida, sobrescribe el mismo archivo en vez de crear otro.
    // arrayBuffer() lee el archivo en un hilo nativo; los bytes no pasan por JSON.
    const path = `${userId}/posts/${id}.jpg`;
    const bytes = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    ensureStorageOk(uploadError);

    // Paso 2: crear la fila. Si la app murió entre el paso 1 y el 2, el reintento repite
    // ambos pasos sin duplicar nada (mismo archivo, mismo id).
    ensureOk(
      await supabase
        .from('posts')
        .upsert({ id, author_id: userId, image_path: path, caption }, { onConflict: 'id', ignoreDuplicates: true }),
    );

    // La copia local ya no hace falta. Si falla el borrado no es grave (queda en documentos).
    try {
      file.delete();
    } catch {}
  },

  async CREATE_STORY({ id, localUri }, userId) {
    // Mismo patrón idempotente que CREATE_POST: ruta fija + upsert, y fila con ON CONFLICT DO NOTHING.
    const file = new File(localUri);
    if (!file.exists) throw new RemoteError('La imagen local ya no existe', 'LOCAL_FILE_MISSING', 400);
    const path = `${userId}/stories/${id}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(path, await file.arrayBuffer(), { contentType: 'image/jpeg', upsert: true });
    ensureStorageOk(uploadError);
    // expires_at lo pone el servidor (default now() + 24 h): el reloj del celular no es confiable.
    ensureOk(
      await supabase
        .from('stories')
        .upsert({ id, author_id: userId, image_path: path }, { onConflict: 'id', ignoreDuplicates: true }),
    );
    try {
      file.delete();
    } catch {}
  },

  async RESPOND_FOLLOW_REQUEST({ followerId, accept }, userId) {
    // RLS (follows_update / follows_delete): solo el dueño de la cuenta seguida puede hacerlo.
    // Si la persona canceló su solicitud mientras yo estaba sin red, el UPDATE/DELETE afecta
    // 0 filas: no es error, el estado final es coherente (no queda solicitud).
    if (accept) {
      ensureOk(
        await supabase
          .from('follows')
          .update({ status: 'accepted' })
          .eq('follower_id', followerId)
          .eq('following_id', userId),
      );
    } else {
      ensureOk(await supabase.from('follows').delete().eq('follower_id', followerId).eq('following_id', userId));
    }
  },

  async UPDATE_PROFILE({ fullName, bio, isPrivate }, userId) {
    // Escribir el estado completo es idempotente: repetirlo deja el perfil igual.
    // Si is_private pasa a false, el trigger accept_pending_on_public acepta las solicitudes pendientes.
    ensureOk(
      await supabase.from('profiles').update({ full_name: fullName, bio, is_private: isPrivate }).eq('id', userId),
    );
  },

  async SEND_MESSAGE({ id, conversationId, body }, userId) {
    // RLS (messages_insert) exige que yo sea el remitente Y miembro de la conversación.
    ensureOk(
      await supabase
        .from('messages')
        .upsert({ id, conversation_id: conversationId, sender_id: userId, body }, { onConflict: 'id', ignoreDuplicates: true }),
    );
  },
};

export function executeOperation(operation: SyncOperation, userId: string): Promise<void> {
  // El cast es seguro: `operation.type` y `operation.payload` vienen emparejados por la unión.
  const handler = operationHandlers[operation.type] as (p: unknown, u: string) => Promise<void>;
  return handler(operation.payload, userId);
}
