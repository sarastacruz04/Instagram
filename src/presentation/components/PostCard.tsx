import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { Link, router } from 'expo-router';
import { Alert, Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { plural, timeAgo } from '@/core/format';

import { toggleLike, usePosts } from '../stores/postsStore';
import { useViewport } from '../stores/viewportStore';
import { colors, spacing, typography } from '../theme';
import { Avatar } from './Avatar';
import { MediaImage } from './MediaImage';

/**
 * Recibe solo el ID y se suscribe a SU post con un selector. Cuando cambia el like de un post,
 * solo se re-renderiza ESA tarjeta, no el feed entero (clave para mantener 60 FPS).
 */
export function PostCard({ postId, trackViewport = false }: { postId: string; trackViewport?: boolean }) {
  const post = usePosts((s) => s.byId[postId]);
  const { width } = useWindowDimensions();
  // Solo en el feed: ¿esta celda salió del viewport? (selector de un booleano por celda).
  const hidden = useViewport((s) => trackViewport && s.hidden[postId] === true);

  if (!post) return null;

  const onShare = () => {
    Alert.alert('Compartir', undefined, [
      // Referencia INTERNA: el post viaja por DM y se abre dentro de la app.
      { text: 'Enviar por mensaje', onPress: () => router.push(`/share/${post.id}`) },
      {
        // Enlace EXTERNO: createURL arma el link según el entorno: exp://…/--/post/<id> en
        // Expo Go, instagramclone://post/<id> en una build propia. Lo intercepta +native-intent.
        text: 'Compartir enlace',
        onPress: () => {
          const url = Linking.createURL(`post/${post.id}`);
          void Share.share({ message: `Mira esta publicación de @${post.authorUsername}: ${url}` });
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.card}>
      <Link href={`/user/${post.authorId}`} asChild>
        <Pressable style={styles.header}>
          <Avatar uri={post.authorAvatarUrl} size={32} />
          <Text style={typography.username}>{post.authorUsername}</Text>
          {post.pending ? <Text style={typography.caption}> · Publicando…</Text> : null}
        </Pressable>
      </Link>

      {/* Alto FIJO (cuadrado): la lista conoce el tamaño antes de cargar la imagen → sin saltos de layout. */}
      <MediaImage path={post.imagePath} localUri={post.localImageUri} size={width} visible={!hidden} />

      <View style={styles.actions}>
        <Pressable onPress={() => toggleLike(post.id)} hitSlop={8} disabled={post.pending}>
          <Ionicons
            name={post.likedByMe ? 'heart' : 'heart-outline'}
            size={26}
            color={post.likedByMe ? colors.like : colors.text}
          />
        </Pressable>
        <Link href={`/comments/${post.id}`} asChild disabled={post.pending}>
          <Pressable hitSlop={8}>
            <Ionicons name="chatbubble-outline" size={24} color={colors.text} />
          </Pressable>
        </Link>
        <Pressable onPress={onShare} hitSlop={8} disabled={post.pending}>
          <Ionicons name="paper-plane-outline" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {post.likeCount > 0 ? <Text style={typography.username}>{plural(post.likeCount, 'Me gusta', 'Me gusta')}</Text> : null}
        {post.caption ? (
          <Text style={typography.body}>
            <Text style={typography.username}>{post.authorUsername} </Text>
            {post.caption}
          </Text>
        ) : null}
        {post.commentCount > 0 ? (
          <Link href={`/comments/${post.id}`} style={styles.muted}>
            {post.commentCount === 1 ? 'Ver 1 comentario' : `Ver los ${post.commentCount} comentarios`}
          </Link>
        ) : null}
        <Text style={typography.caption}>{timeAgo(post.createdAt)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  body: { paddingHorizontal: spacing.md, gap: 4 },
  muted: { color: colors.textSecondary, fontSize: 14 },
});
