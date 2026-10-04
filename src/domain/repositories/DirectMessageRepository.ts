import type { InboxItem, Message } from '../entities/Message';
import type { Profile } from '../entities/Profile';

export interface MessageEvents {
  /** Mensaje nuevo en CUALQUIERA de mis conversaciones (míos incluidos: eco del servidor). */
  onInsert(message: Message): void;
  /** Cambió delivered_at / read_at de un mensaje (confirmaciones de entrega y lectura). */
  onUpdate(message: Message): void;
  /** El WebSocket se reconectó: pudieron perderse eventos mientras estaba caído. */
  onResubscribed(): void;
}

export interface TypingChannel {
  /** Avisar que estoy escribiendo (el canal lo limita: como máximo 1 envío cada 2 s). */
  notifyTyping(): void;
  leave(): void;
}

export interface DirectMessageRepository {
  getInbox(): Promise<InboxItem[]>;
  getOrCreateConversation(otherUserId: string): Promise<string>;
  /** El otro participante de la conversación (para la cabecera del chat). */
  getPeer(conversationId: string): Promise<Profile | null>;
  /** Página de mensajes, del más nuevo al más viejo, anteriores a `before`. */
  getMessages(conversationId: string, before: string | null, limit: number): Promise<Message[]>;
  markDelivered(conversationId: string): Promise<void>;
  markAllDelivered(): Promise<void>;
  markRead(conversationId: string): Promise<void>;
  /** Una sola suscripción global a mis mensajes (RLS filtra a mis conversaciones). */
  subscribe(userId: string, events: MessageEvents): () => void;
  joinTypingChannel(conversationId: string, onPeerTyping: () => void): TypingChannel;
}
