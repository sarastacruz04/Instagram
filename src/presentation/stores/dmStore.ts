import { AppState } from 'react-native';
import { create } from 'zustand';

import { newId } from '@/core/ids';
import { dmRepository, syncQueue } from '@/di/container';
import type { InboxItem, Message } from '@/domain/entities/Message';

import { useSession } from './sessionStore';

const PAGE = 30;
const TYPING_TIMEOUT_MS = 3500;

interface DmState {
  /** Ordenada por último mensaje (más reciente primero). */
  inbox: InboxItem[];
  inboxLoaded: boolean;
  /** Mensajes por conversación, en orden cronológico ascendente. */
  messages: Record<string, Message[]>;
  hasOlder: Record<string, boolean>;
  typing: Record<string, boolean>;
  /** Conversación abierta y enfocada: sus mensajes nuevos se marcan como leídos al llegar. */
  activeConversationId: string | null;
}

export const useDm = create<DmState>(() => ({
  inbox: [],
  inboxLoaded: false,
  messages: {},
  hasOlder: {},
  typing: {},
  activeConversationId: null,
}));

/** Total de no leídos (insignia del avión de papel). */
export const selectUnreadTotal = (s: DmState) => s.inbox.reduce((n, c) => n + c.unread, 0);

const myId = () => useSession.getState().userId;

// ------------------------------------------------------------------ helpers puros de estado

function byCreatedAt(a: Message, b: Message): number {
  return a.createdAt.localeCompare(b.createdAt);
}

/** Inserta o reemplaza por id (deduplicación del eco de Realtime) y mantiene el orden. */
function mergeMessages(list: Message[], incoming: Message[]): Message[] {
  const map = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort(byCreatedAt);
}

function putMessages(conversationId: string, incoming: Message[]): void {
  useDm.setState((s) => ({
    messages: { ...s.messages, [conversationId]: mergeMessages(s.messages[conversationId] ?? [], incoming) },
  }));
}

/**
 * REORDENAMIENTO de la bandeja: la conversación con el mensaje nuevo pasa al PRIMER lugar.
 * Como un mensaje nuevo siempre es el más reciente, basta con sacarla y ponerla al frente
 * (O(n)); no hace falta reordenar toda la lista.
 */
function bumpConversation(conversationId: string, patch: (item: InboxItem) => InboxItem): boolean {
  const { inbox } = useDm.getState();
  const i = inbox.findIndex((c) => c.conversationId === conversationId);
  if (i === -1) return false;
  const updated = patch(inbox[i]);
  useDm.setState({ inbox: [updated, ...inbox.slice(0, i), ...inbox.slice(i + 1)] });
  return true;
}

// ------------------------------------------------------------------ carga

export async function loadInbox(): Promise<void> {
  try {
    const inbox = await dmRepository.getInbox();
    useDm.setState({ inbox, inboxLoaded: true });
  } catch {
    useDm.setState({ inboxLoaded: true });
  }
}

export async function loadMessages(conversationId: string): Promise<void> {
  const page = await dmRepository.getMessages(conversationId, null, PAGE);
  // Mensajes que siguen en la cola offline (p. ej. enviados sin red antes de reiniciar la app).
  const me = myId();
  const pending = (await syncQueue.pendingOperations())
    .filter((op) => op.type === 'SEND_MESSAGE' && op.payload.conversationId === conversationId)
    .map((op) => op.payload as { id: string; conversationId: string; body: string })
    .map<Message>((p) => ({
      id: p.id, conversationId, senderId: me ?? '', body: p.body, createdAt: new Date().toISOString(),
      deliveredAt: null, readAt: null, syncState: 'pending',
    }));
  putMessages(conversationId, [...page, ...pending]);
  useDm.setState((s) => ({ hasOlder: { ...s.hasOlder, [conversationId]: page.length === PAGE } }));
}

export async function loadOlder(conversationId: string): Promise<void> {
  const { messages, hasOlder } = useDm.getState();
  const oldest = messages[conversationId]?.find((m) => !m.syncState);
  if (!hasOlder[conversationId] || !oldest) return;
  const page = await dmRepository.getMessages(conversationId, oldest.createdAt, PAGE);
  putMessages(conversationId, page);
  useDm.setState((s) => ({ hasOlder: { ...s.hasOlder, [conversationId]: page.length === PAGE } }));
}

// ------------------------------------------------------------------ enviar (optimista + cola)

export async function sendMessage(conversationId: string, body: string): Promise<void> {
  const me = myId();
  const text = body.trim();
  if (!me || !text) return;

  const message: Message = {
    id: newId(), conversationId, senderId: me, body: text, createdAt: new Date().toISOString(),
    deliveredAt: null, readAt: null, syncState: 'pending',
  };
  putMessages(conversationId, [message]); // aparece YA (0 ms), con el reloj de "enviando"
  bumpConversation(conversationId, (c) => ({
    ...c, lastMessageAt: message.createdAt, lastMessagePreview: text, lastSenderId: me,
  }));
  await syncQueue.enqueue({ type: 'SEND_MESSAGE', payload: { id: message.id, conversationId, body: text } });
}

function setSyncState(conversationId: string, id: string, syncState: Message['syncState']): void {
  useDm.setState((s) => {
    const list = s.messages[conversationId];
    if (!list) return s;
    return { messages: { ...s.messages, [conversationId]: list.map((m) => (m.id === id ? { ...m, syncState } : m)) } };
  });
}

syncQueue.onOperationCompleted((op) => {
  if (op.type === 'SEND_MESSAGE') setSyncState(op.payload.conversationId, op.payload.id, undefined);
});
syncQueue.onPermanentFailure((op) => {
  if (op.type === 'SEND_MESSAGE') setSyncState(op.payload.conversationId, op.payload.id, 'failed');
});

// ------------------------------------------------------------------ leído / conversación activa

export function setActiveConversation(conversationId: string | null): void {
  useDm.setState({ activeConversationId: conversationId });
  if (conversationId) markConversationRead(conversationId);
}

function markConversationRead(conversationId: string): void {
  // Local primero (la insignia baja al instante) y luego el servidor, que emite los UPDATE
  // de read_at → el remitente ve "Visto".
  useDm.setState((s) => ({
    inbox: s.inbox.map((c) => (c.conversationId === conversationId ? { ...c, unread: 0 } : c)),
  }));
  void dmRepository.markRead(conversationId).catch(() => {});
}

// ------------------------------------------------------------------ "Escribiendo…"

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** El otro está escribiendo: se muestra y se apaga solo si deja de llegar el evento. */
export function peerTyping(conversationId: string): void {
  useDm.setState((s) => ({ typing: { ...s.typing, [conversationId]: true } }));
  const old = typingTimers.get(conversationId);
  if (old) clearTimeout(old);
  typingTimers.set(
    conversationId,
    setTimeout(() => stopTyping(conversationId), TYPING_TIMEOUT_MS),
  );
}

function stopTyping(conversationId: string): void {
  const t = typingTimers.get(conversationId);
  if (t) clearTimeout(t);
  typingTimers.delete(conversationId);
  useDm.setState((s) => (s.typing[conversationId] ? { typing: { ...s.typing, [conversationId]: false } } : s));
}

// ------------------------------------------------------------------ eventos en tiempo real

function onIncoming(message: Message): void {
  const me = myId();
  putMessages(message.conversationId, [message]);
  const fromPeer = message.senderId !== me;
  if (fromPeer) stopTyping(message.conversationId); // si ya llegó el mensaje, dejó de escribir

  const isOpen =
    useDm.getState().activeConversationId === message.conversationId && AppState.currentState === 'active';

  const known = bumpConversation(message.conversationId, (c) => ({
    ...c,
    lastMessageAt: message.createdAt,
    lastMessagePreview: message.body,
    lastSenderId: message.senderId,
    unread: fromPeer && !isOpen ? c.unread + 1 : c.unread,
  }));
  if (!known) void loadInbox(); // conversación nueva: traerla completa (con el perfil del otro)

  if (fromPeer) {
    // Confirmaciones: si el chat está abierto → leído; si no → al menos entregado.
    if (isOpen) markConversationRead(message.conversationId);
    else void dmRepository.markDelivered(message.conversationId).catch(() => {});
  }
}

function onUpdated(message: Message): void {
  // Solo interesan delivered_at / read_at; se conserva el resto de lo que ya tenemos.
  useDm.setState((s) => {
    const list = s.messages[message.conversationId];
    if (!list) return s;
    return {
      messages: {
        ...s.messages,
        [message.conversationId]: list.map((m) =>
          m.id === message.id ? { ...m, deliveredAt: message.deliveredAt, readAt: message.readAt } : m,
        ),
      },
    };
  });
}

/** Tras reconectar el WebSocket: recuperar lo que se perdió mientras estuvo caído. */
function resync(): void {
  void loadInbox();
  void dmRepository.markAllDelivered().catch(() => {});
  const active = useDm.getState().activeConversationId;
  if (active) {
    void loadMessages(active).catch(() => {});
    markConversationRead(active); // lo que llegó mientras estaba en segundo plano ya lo estoy viendo
  }
}

/**
 * Arranca la mensajería de la sesión: suscripción global + confirmaciones de entrega.
 * Devuelve la función de limpieza (al cerrar sesión).
 */
export function startDirectMessages(userId: string): () => void {
  void loadInbox();
  void dmRepository.markAllDelivered().catch(() => {});
  const unsubscribe = dmRepository.subscribe(userId, {
    onInsert: onIncoming,
    onUpdate: onUpdated,
    onResubscribed: resync,
  });
  // Al volver a primer plano: el socket pudo estar suspendido por el SO.
  const appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') resync();
  });
  return () => {
    unsubscribe();
    appState.remove();
    typingTimers.forEach(clearTimeout);
    typingTimers.clear();
    useDm.setState({ inbox: [], inboxLoaded: false, messages: {}, hasOlder: {}, typing: {}, activeConversationId: null });
  };
}
