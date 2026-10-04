import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { Link, Stack } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PostCard } from '@/presentation/components/PostCard';
import { StoriesBar } from '@/presentation/components/StoriesBar';
import { selectUnreadTotal, useDm } from '@/presentation/stores/dmStore';
import { EMPTY_LIST, feedKey, loadList, usePosts } from '@/presentation/stores/postsStore';
import { loadStories } from '@/presentation/stores/storiesStore';
import { feedViewabilityConfig, onFeedViewableItemsChanged } from '@/presentation/stores/viewportStore';
import { colors, spacing, typography } from '@/presentation/theme';

export default function HomeScreen() {
  // Selector sobre la LISTA (ids + paginación), no sobre los posts: dar like no re-renderiza
  // el feed completo, solo la tarjeta afectada (que se suscribe a su propio post).
  const list = usePosts((s) => s.lists[feedKey]) ?? EMPTY_LIST;

  useEffect(() => {
    void loadList(feedKey, 'refresh');
    void loadStories();
  }, []);

  const refresh = () => {
    void loadList(feedKey, 'refresh');
    void loadStories();
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: '',
          headerLeft: () => <Text style={typography.logo}>Instagram</Text>,
          headerRight: () => <InboxButton />,
        }}
      />
      {list.fromCache ? (
        <Text style={styles.cacheNote}>Sin conexión · mostrando publicaciones guardadas</Text>
      ) : null}
      {/* FlashList RECICLA las celdas: al salir una de pantalla, su vista se reutiliza para la
          que entra, en lugar de crear y destruir vistas nativas en cada scroll. */}
      <FlashList
        data={list.ids}
        keyExtractor={(id) => id}
        renderItem={({ item }) => <PostCard postId={item} trackViewport />}
        // Viewport: cuando una celda sale de pantalla antes de que su imagen llegue,
        // se cancela la descarga (CachedImage → AbortController).
        viewabilityConfig={feedViewabilityConfig}
        onViewableItemsChanged={onFeedViewableItemsChanged}
        refreshing={list.refreshing}
        onRefresh={refresh}
        onEndReached={() => loadList(feedKey, 'more')}
        onEndReachedThreshold={0.5}
        // Las historias van como CABECERA de la lista: se desplazan junto con el feed.
        ListHeaderComponent={<StoriesBar />}
        ListEmptyComponent={
          !list.refreshing ? (
            <View style={styles.empty}>
              <Text style={typography.title}>Bienvenido a Instagram</Text>
              <Text style={typography.caption}>Sigue a otras cuentas desde Explorar para ver sus fotos aquí.</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

/** Avión de papel con insignia de no leídos (se actualiza en vivo con Realtime). */
function InboxButton() {
  const unread = useDm(selectUnreadTotal);
  return (
    <Link href="/inbox" asChild>
      <Pressable hitSlop={8}>
        <Ionicons name="paper-plane-outline" size={24} color={colors.text} />
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute', top: -6, right: -8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: colors.like, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  container: { flex: 1, backgroundColor: colors.background },
  cacheNote: { textAlign: 'center', fontSize: 12, color: colors.textSecondary, paddingVertical: spacing.xs },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, marginTop: spacing.xl },
});
