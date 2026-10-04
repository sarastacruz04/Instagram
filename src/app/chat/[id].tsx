import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dmRepository } from '@/di/container';
import { statusOf, type Message } from '@/domain/entities/Message';
import type { Profile } from '@/domain/entities/Profile';
import type { TypingChannel } from '@/domain/repositories/DirectMessageRepository';
import { Avatar } from '@/presentation/components/Avatar';
import { MessageBubble } from '@/presentation/components/MessageBubble';
import { loadMessages, loadOlder, peerTyping, sendMessage, setActiveConversation, useDm } from '@/presentation/stores/dmStore';
import { useSession } from '@/presentation/stores/sessionStore';
import { colors, spacing, typography } from '@/presentation/theme';

const NO_MESSAGES: Message[] = [];
const STATUS_LABEL = { pending: 'Enviando…', failed: 'No se envió', sent: 'Enviado', delivered: 'Entregado', seen: 'Visto' };

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const myId = useSession((s) => s.userId);
  const messages = useDm((s) => s.messages[id]) ?? NO_MESSAGES;
  const typing = useDm((s) => s.typing[id] === true);
  const insets = useSafeAreaInsets();
  const [peer, setPeer] = useState<Profile | null>(null);
  const [text, setText] = useState('');
  const typingChannel = useRef<TypingChannel | null>(null);

  useEffect(() => {
    let active = true;
    void loadMessages(id).catch(() => {});
    dmRepository.getPeer(id).then((p) => active && setPeer(p)).catch(() => {});
    // Canal efímero de "Escribiendo…" solo mientras el chat está montado.
    typingChannel.current = dmRepository.joinTypingChannel(id, () => peerTyping(id));
    return () => {
      active = false;
      typingChannel.current?.leave();
      typingChannel.current = null;
    };
  }, [id]);

  // Conversación ACTIVA solo mientras la pantalla tiene el foco: así los mensajes que llegan
  // se marcan "Visto" en el acto, y al salir vuelven a contar como no leídos.
  useFocusEffect(
    useCallback(() => {
      setActiveConversation(id);
      return () => setActiveConversation(null);
    }, [id]),
  );

  // FlatList INVERTIDA: el índice 0 se dibuja ABAJO. Por eso los datos van del más nuevo al más viejo.
  const data = useMemo(() => [...messages].reverse(), [messages]);

  // "Visto/Entregado" solo bajo MI último mensaje (como Instagram).
  const lastMine = data.find((m) => m.senderId === myId);

  const onChange = (value: string) => {
    setText(value);
    if (value.length > 0) typingChannel.current?.notifyTyping(); // throttled en el repositorio
  };

  const onSend = () => {
    if (!text.trim()) return;
    void sendMessage(id, text);
    setText('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen
        options={{
          headerTitle: () =>
            peer ? (
              <Link href={`/user/${peer.id}`} asChild>
                <Pressable style={styles.header}>
                  <Avatar uri={peer.avatarUrl} size={30} />
                  <View>
                    <Text style={typography.username}>{peer.username}</Text>
                    {typing ? <Text style={typography.caption}>Escribiendo…</Text> : null}
                  </View>
                </Pressable>
              </Link>
            ) : null,
        }}
      />
      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <View>
            <MessageBubble message={item} mine={item.senderId === myId} />
            {item.id === lastMine?.id ? <Text style={styles.status}>{STATUS_LABEL[statusOf(item)]}</Text> : null}
          </View>
        )}
        // En una lista invertida, el "final" es ARRIBA: ahí se cargan los mensajes más viejos.
        onEndReached={() => void loadOlder(id).catch(() => {})}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={typing ? <TypingBubble /> : null}
        contentContainerStyle={{ paddingVertical: spacing.sm }}
      />
      <View style={{ paddingBottom: insets.bottom + spacing.sm }}>
      <View style={styles.inputBar}>
        <TextInput
          value={text}
          onChangeText={onChange}
          placeholder="Mensaje…"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          multiline
        />
        {text.trim() ? (
          <Pressable onPress={onSend} hitSlop={8}>
            <Text style={styles.send}>Enviar</Text>
          </Pressable>
        ) : (
          <Ionicons name="happy-outline" size={24} color={colors.textSecondary} />
        )}
      </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function TypingBubble() {
  return (
    <View style={styles.typingBubble}>
      <Text style={typography.caption}>Escribiendo…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  status: { ...typography.caption, textAlign: 'right', paddingHorizontal: spacing.lg, marginTop: 2 },
  typingBubble: {
    alignSelf: 'flex-start', marginHorizontal: spacing.md, marginVertical: 4, paddingHorizontal: 14,
    paddingVertical: 9, borderRadius: 20, backgroundColor: colors.surface,
  },
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.md, marginTop: spacing.xs,
    paddingHorizontal: spacing.lg, paddingVertical: 4, borderRadius: 24, backgroundColor: colors.surface,
  },
  input: { flex: 1, fontSize: 15, maxHeight: 120, paddingVertical: 8, color: colors.text },
  send: { color: colors.primary, fontWeight: '700' },
});
