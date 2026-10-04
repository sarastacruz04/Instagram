import type { InboxItem, Message } from '@/domain/entities/Message';
import type { Profile } from '@/domain/entities/Profile';
import { AppError } from '@/domain/errors';
import type { DirectMessageRepository, MessageEvents, TypingChannel } from '@/domain/repositories/DirectMessageRepository';

import { PROFILE_COLUMNS, toProfile, type ProfileRow } from '../mappers/profileMapper';
import { currentUserId, supabase } from '../remote/supabaseClient';

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

interface InboxRow {
  id: string;
  other_id: string;
  username: string;
  avatar_url: string | null;
  last_message_at: string;
  last_message_preview: string;
  last_sender_id: string | null;
  unread: number;
}

const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, body, created_at, delivered_at, read_at';
const TYPING_THROTTLE_MS = 2000;

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    body: r.body,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at,
    readAt: r.read_at,
  };
}

function check(error: { message: string } | null, status: number): void {
  if (error) throw new AppError(status === 0 ? 'Sin conexión' : error.message, status === 0 ? 'network' : 'unknown');
}

export class SupabaseDirectMessageRepository implements DirectMessageRepository {
  async getInbox(): Promise<InboxItem[]> {
    const { data, error, status } = await supabase.rpc('get_inbox');
    check(error, status);
    return ((data ?? []) as InboxRow[]).map((r) => ({
      conversationId: r.id,
      otherId: r.other_id,
      username: r.username,
      avatarUrl: r.avatar_url,
      lastMessageAt: r.last_message_at,
      lastMessagePreview: r.last_message_preview,
      lastSenderId: r.last_sender_id,
      unread: r.unread,
    }));
  }

  async getOrCreateConversation(otherUserId: string): Promise<string> {
    const { data, error, status } = await supabase.rpc('get_or_create_conversation', { other: otherUserId });
    check(error, status);
    return data as string;
  }

  async getPeer(conversationId: string): Promise<Profile | null> {
    const me = await currentUserId();
    const { data, error, status } = await supabase
      .from('conversations')
      .select('user_a, user_b')
      .eq('id', conversationId)
      .maybeSingle<{ user_a: string; user_b: string }>();
    check(error, status);
    if (!data) return null;
    const otherId = data.user_a === me ? data.user_b : data.user_a;
    const res = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', otherId).maybeSingle<ProfileRow>();
    check(res.error, res.status);
    return res.data ? toProfile(res.data) : null;
  }

  async getMessages(conversationId: string, before: string | null, limit: number): Promise<Message[]> {
    let query = supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (before) query = query.lt('created_at', before); // paginación por cursor hacia atrás
    const { data, error, status } = await query.returns<MessageRow[]>();
    check(error, status);
    return (data ?? []).map(toMessage);
  }

  async markDelivered(conversationId: string): Promise<void> {
    await supabase.rpc('mark_delivered', { conv: conversationId });
  }

  async markAllDelivered(): Promise<void> {
    await supabase.rpc('mark_all_delivered');
  }

  async markRead(conversationId: string): Promise<void> {
    await supabase.rpc('mark_read', { conv: conversationId });
  }

  /**
   * UNA sola suscripción para toda la mensajería (no una por conversación): menos canales
   * abiertos en el WebSocket y la bandeja se actualiza aunque el chat no esté abierto.
   * No hace falta filtro: RLS (messages_select → is_member) hace que Realtime solo me
   * entregue filas de MIS conversaciones.
   */
  subscribe(userId: string, events: MessageEvents): () => void {
    let subscribedOnce = false;
    const channel = supabase
      .channel(`dm:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) =>
        events.onInsert(toMessage(p.new as MessageRow)),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) =>
        events.onUpdate(toMessage(p.new as MessageRow)),
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        // La 1ª suscripción es la normal. Si vuelve a SUBSCRIBED, el socket se cayó y se
        // reconectó solo: los eventos de ese intervalo NO se reenvían → hay que resincronizar.
        if (subscribedOnce) events.onResubscribed();
        subscribedOnce = true;
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }

  /**
   * "Escribiendo…" con BROADCAST: mensajes efímeros por el WebSocket que NO pasan por la
   * base de datos (no tiene sentido guardar en Postgres cada pulsación de tecla).
   * Canal PRIVADO: Realtime verifica las políticas sobre realtime.messages → solo los dos
   * miembros de la conversación pueden unirse, escuchar y emitir.
   */
  joinTypingChannel(conversationId: string, onPeerTyping: () => void): TypingChannel {
    const channel = supabase
      .channel(`chat:${conversationId}`, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, () => onPeerTyping())
      .subscribe();

    let lastSent = 0;
    return {
      notifyTyping() {
        // THROTTLE: aunque se llame en cada tecla, se envía como máximo 1 evento cada 2 s.
        const now = Date.now();
        if (now - lastSent < TYPING_THROTTLE_MS) return;
        lastSent = now;
        void channel.send({ type: 'broadcast', event: 'typing', payload: {} });
      },
      leave() {
        supabase.removeChannel(channel);
      },
    };
  }
}
