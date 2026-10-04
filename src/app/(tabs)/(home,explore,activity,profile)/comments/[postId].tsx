import { FlashList } from '@shopify/flash-list';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { timeAgo } from '@/core/format';
import { buildThreads, rootIdOf } from '@/domain/comments/threads';
import type { Comment } from '@/domain/entities/Post';
import { Avatar } from '@/presentation/components/Avatar';
import { addComment, loadComments, subscribeToComments, useComments } from '@/presentation/stores/commentsStore';
import { useSession } from '@/presentation/stores/sessionStore';
import { colors, spacing, typography } from '@/presentation/theme';

const NO_COMMENTS: Comment[] = [];

export default function CommentsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const comments = useComments((s) => s.byPost[postId]) ?? NO_COMMENTS;
  const me = useSession((s) => s.profile);
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);

  // Carga inicial + suscripción Realtime mientras la pantalla está montada.
  // El cleanup cierra el canal WebSocket al salir (sin fugas de suscripciones).
  useEffect(() => {
    void loadComments(postId).catch(() => {});
    return subscribeToComments(postId);
  }, [postId]);

  // Recalcular los hilos solo cuando cambia la lista (no en cada tecla del input).
  const rows = useMemo(() => buildThreads(comments), [comments]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    void addComment(postId, body, replyTo ? rootIdOf(replyTo) : null);
    setText('');
    setReplyTo(null);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen options={{ title: 'Comentarios' }} />
      <FlashList
        data={rows}
        keyExtractor={(r) => r.comment.id}
        renderItem={({ item }) => <CommentItem row={item} onReply={() => setReplyTo(item.comment)} />}
        ListEmptyComponent={<Text style={styles.empty}>Aún no hay comentarios. ¡Sé el primero!</Text>}
      />
      {replyTo ? (
        <View style={styles.replyBar}>
          <Text style={typography.caption}>Respondiendo a @{replyTo.authorUsername}</Text>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
            <Text style={typography.caption}>✕</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Avatar uri={me?.avatarUrl ?? null} size={32} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={replyTo ? `Responder a ${replyTo.authorUsername}…` : 'Añade un comentario…'}
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          multiline
        />
        <Pressable onPress={send} disabled={!text.trim()} hitSlop={8}>
          <Text style={[styles.publish, !text.trim() && { opacity: 0.4 }]}>Publicar</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function CommentItem({ row, onReply }: { row: { comment: Comment; depth: 0 | 1 }; onReply: () => void }) {
  const { comment, depth } = row;
  return (
    <View style={[styles.item, depth === 1 && styles.reply, comment.syncState === 'pending' && { opacity: 0.6 }]}>
      <Avatar uri={comment.authorAvatarUrl} size={depth === 1 ? 24 : 32} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={typography.body}>
          <Text style={typography.username}>{comment.authorUsername} </Text>
          {comment.body}
        </Text>
        <View style={styles.meta}>
          <Text style={typography.caption}>
            {comment.syncState === 'pending' ? 'Enviando…' : timeAgo(comment.createdAt)}
          </Text>
          {comment.syncState === 'failed' ? (
            <Text style={[typography.caption, { color: colors.like }]}>No se pudo publicar</Text>
          ) : (
            <Pressable onPress={onReply} hitSlop={6}>
              <Text style={[typography.caption, { fontWeight: '600' }]}>Responder</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  item: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  reply: { paddingLeft: spacing.lg + 44 },
  meta: { flexDirection: 'row', gap: spacing.lg },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.xl },
  replyBar: {
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  input: { flex: 1, fontSize: 14, maxHeight: 100, color: colors.text },
  publish: { color: colors.primary, fontWeight: '600' },
});
