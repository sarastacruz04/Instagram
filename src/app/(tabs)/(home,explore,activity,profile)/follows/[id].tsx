import { FlashList } from '@shopify/flash-list';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { profileRepository } from '@/di/container';
import type { Profile } from '@/domain/entities/Profile';
import { UserRow } from '@/presentation/components/UserRow';
import { colors, spacing } from '@/presentation/theme';

export default function FollowsScreen() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind: 'followers' | 'following' }>();
  const [people, setPeople] = useState<Profile[] | null>(null);

  useEffect(() => {
    let active = true;
    const load = kind === 'following' ? profileRepository.getFollowing(id) : profileRepository.getFollowers(id);
    load.then((p) => active && setPeople(p)).catch(() => active && setPeople([]));
    return () => {
      active = false;
    };
  }, [id, kind]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: kind === 'following' ? 'Seguidos' : 'Seguidores' }} />
      {people === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <FlashList
          data={people}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <UserRow profile={item} />}
          ListEmptyComponent={<Text style={styles.empty}>No hay nadie aquí todavía.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.xl },
});
