import { FlashList } from '@shopify/flash-list';
import { Link, Stack } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { timeAgo } from '@/core/format';
import { previewOf, type InboxItem } from '@/domain/entities/Message';
import { Avatar } from '@/presentation/components/Avatar';
import { loadInbox, useDm } from '@/presentation/stores/dmStore';
import { useSession } from '@/presentation/stores/sessionStore';
import { colors, spacing, typography } from '@/presentation/theme';

export default function InboxScreen() {
  const inbox = useDm((s) => s.inbox);
  const loaded = useDm((s) => s.inboxLoaded);
  const me = useSession((s) => s.profile);

  useEffect(() => {
    void loadInbox();
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: me?.username ?? 'Mensajes' }} />
      {/* El ORDEN lo mantiene el store: cada mensaje nuevo sube su conversación al primer
          lugar en tiempo real (bumpConversation). La lista solo pinta. */}
      <FlashList
        data={inbox}
        keyExtractor={(c) => c.conversationId}
        renderItem={({ item }) => <InboxRow item={item} myId={me?.id ?? null} />}
        onRefresh={loadInbox}
        refreshing={false}
        ListHeaderComponent={<Text style={styles.section}>Mensajes</Text>}
        ListEmptyComponent={
          loaded ? (
            <Text style={styles.empty}>Aún no tienes mensajes. Abre un perfil y toca “Mensaje”.</Text>
          ) : null
        }
      />
    </View>
  );
}

function InboxRow({ item, myId }: { item: InboxItem; myId: string | null }) {
  const typing = useDm((s) => s.typing[item.conversationId] === true);
  const unread = item.unread > 0;
  const mine = item.lastSenderId === myId;
  const preview = typing
    ? 'Escribiendo…'
    : `${mine ? 'Tú: ' : ''}${previewOf(item.lastMessagePreview)}`;

  return (
    <Link href={`/chat/${item.conversationId}`} asChild>
      <Pressable style={styles.row}>
        <Avatar uri={item.avatarUrl} size={56} />
        <View style={{ flex: 1 }}>
          <Text style={[typography.body, unread && styles.bold]}>{item.username}</Text>
          <Text numberOfLines={1} style={[styles.preview, unread && styles.bold, typing && styles.typing]}>
            {preview} · {timeAgo(item.lastMessageAt)}
          </Text>
        </View>
        {unread ? <View style={styles.dot} /> : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  section: { ...typography.title, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  preview: { color: colors.textSecondary, fontSize: 14 },
  bold: { fontWeight: '700', color: colors.text },
  typing: { color: colors.text, fontStyle: 'italic' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.xl, paddingHorizontal: spacing.xl },
});
