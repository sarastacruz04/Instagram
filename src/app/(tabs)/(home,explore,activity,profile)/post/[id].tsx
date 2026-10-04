import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PostCard } from '@/presentation/components/PostCard';
import { ensurePost } from '@/presentation/stores/postsStore';
import { colors, spacing, typography } from '@/presentation/theme';

type LoadState = 'loading' | 'ready' | 'missing';

// Destino del deep link instagramclone://post/<uuid>.
export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let active = true;
    ensurePost(id)
      .then((post) => active && setState(post ? 'ready' : 'missing'))
      .catch(() => active && setState('missing'));
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Publicación' }} />
      {state === 'loading' ? <ActivityIndicator style={{ marginTop: spacing.xl }} /> : null}
      {state === 'missing' ? (
        // RLS: un post de cuenta privada que no sigo "no existe" para mí. Mismo mensaje que Instagram.
        <View style={styles.missing}>
          <Text style={typography.title}>Esta publicación no está disponible</Text>
          <Text style={typography.caption}>Puede que se haya eliminado o que la cuenta sea privada.</Text>
        </View>
      ) : null}
      {state === 'ready' ? (
        <ScrollView>
          <PostCard postId={id} />
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  missing: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
});
