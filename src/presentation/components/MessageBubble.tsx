import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { parsePostReference, type Message } from '@/domain/entities/Message';

import { ensurePost, usePosts } from '../stores/postsStore';
import { colors, spacing, typography } from '../theme';
import { MediaImage } from './MediaImage';

export function MessageBubble({ message, mine }: { message: Message; mine: boolean }) {
  const postId = parsePostReference(message.body);
  const failed = message.syncState === 'failed';

  return (
    <View style={[styles.row, mine ? styles.right : styles.left]}>
      {postId ? (
        <PostReferenceCard postId={postId} />
      ) : (
        <View
          style={[
            styles.bubble,
            mine ? styles.mine : styles.theirs,
            message.syncState === 'pending' && { opacity: 0.6 },
          ]}>
          <Text style={[typography.body, mine && { color: '#fff' }]}>{message.body}</Text>
        </View>
      )}
      {failed ? <Ionicons name="alert-circle" size={16} color={colors.like} /> : null}
    </View>
  );
}

/** "Referencia interna": un post compartido por DM se muestra como tarjeta navegable. */
function PostReferenceCard({ postId }: { postId: string }) {
  const post = usePosts((s) => s.byId[postId]);
  const [missing, setMissing] = useState(false);
  const { width } = useWindowDimensions();
  const size = Math.min(220, width * 0.6);

  useEffect(() => {
    let active = true;
    // RLS decide: si el post es de una cuenta privada que no sigo, no llega.
    ensurePost(postId)
      .then((p) => active && !p && setMissing(true))
      .catch(() => active && setMissing(true));
    return () => {
      active = false;
    };
  }, [postId]);

  if (missing) {
    return (
      <View style={[styles.card, { width: size, padding: spacing.md }]}>
        <Text style={typography.caption}>Publicación no disponible</Text>
      </View>
    );
  }

  return (
    <Pressable style={[styles.card, { width: size }]} onPress={() => router.push(`/post/${postId}`)}>
      <Text style={[typography.username, styles.cardHeader]}>{post?.authorUsername ?? ' '}</Text>
      {post ? <MediaImage path={post.imagePath} size={size} /> : <View style={{ width: size, height: size }} />}
      {post?.caption ? (
        <Text numberOfLines={2} style={[typography.caption, styles.cardCaption]}>
          {post.caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, marginVertical: 2 },
  left: { justifyContent: 'flex-start' },
  right: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '75%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  mine: { backgroundColor: '#3797F0' },
  theirs: { backgroundColor: colors.surface },
  card: { borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface },
  cardHeader: { padding: spacing.sm },
  cardCaption: { padding: spacing.sm },
});
