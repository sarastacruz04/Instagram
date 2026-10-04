import { FlashList } from '@shopify/flash-list';
import { Link } from 'expo-router';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';

import { usePosts } from '../stores/postsStore';
import { colors } from '../theme';
import { MediaImage } from './MediaImage';

interface Props {
  ids: string[];
  header?: ReactElement;
  empty?: ReactElement;
  onEndReached?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

/** Grilla de 3 columnas (explorar / perfil). FlashList recicla las celdas al hacer scroll. */
export function PostGrid({ ids, header, empty, onEndReached, onRefresh, refreshing = false }: Props) {
  const { width } = useWindowDimensions();
  const size = (width - 2) / 3;

  return (
    <FlashList
      data={ids}
      numColumns={3}
      keyExtractor={(id) => id}
      renderItem={({ item }) => <GridCell postId={item} size={size} />}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      onRefresh={onRefresh}
      refreshing={refreshing}
    />
  );
}

function GridCell({ postId, size }: { postId: string; size: number }) {
  const post = usePosts((s) => s.byId[postId]);
  if (!post) return null;
  return (
    <Link href={`/post/${postId}`} asChild disabled={post.pending}>
      <Pressable style={styles.cell}>
        {/* Miniatura: se decodifica a ~1/3 del ancho → ~9 veces menos RAM que la foto completa. */}
        <MediaImage path={post.imagePath} localUri={post.localImageUri} size={size} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  cell: { margin: 0.33, backgroundColor: colors.surface },
});
