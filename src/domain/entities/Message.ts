export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  /** Solo local: 'pending' en la cola offline; 'failed' si el servidor lo rechazó. */
  syncState?: 'pending' | 'failed';
}

/** Estado que ve el REMITENTE, en orden de avance. */
export type MessageStatus = 'pending' | 'failed' | 'sent' | 'delivered' | 'seen';

/**
 * El estado se DERIVA de los datos (no se guarda aparte): así nunca queda inconsistente.
 * pending → sent (el servidor lo tiene) → delivered (llegó al celular del otro) → seen (lo abrió).
 */
export function statusOf(m: Message): MessageStatus {
  if (m.syncState) return m.syncState;
  if (m.readAt) return 'seen';
  if (m.deliveredAt) return 'delivered';
  return 'sent';
}

export interface InboxItem {
  conversationId: string;
  otherId: string;
  username: string;
  avatarUrl: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastSenderId: string | null;
  unread: number;
}

/**
 * "Referencia interna" a un post dentro de un mensaje. Se guarda como texto con un formato
 * fijo y la UI lo muestra como una tarjeta que navega al post dentro de la app.
 */
const POST_REF = /^\[post:([0-9a-f-]{36})\]$/i;

export function postReference(postId: string): string {
  return `[post:${postId}]`;
}

export function parsePostReference(body: string): string | null {
  return body.match(POST_REF)?.[1] ?? null;
}

/** Texto para la vista previa de la bandeja. */
export function previewOf(body: string): string {
  return parsePostReference(body) ? 'Envió una publicación' : body;
}
