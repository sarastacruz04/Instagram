import { FlashList } from '@shopify/flash-list';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { profileRepository } from '@/di/container';
import type { Profile } from '@/domain/entities/Profile';
import { PostGrid } from '@/presentation/components/PostGrid';
import { TextField } from '@/presentation/components/TextField';
import { UserRow } from '@/presentation/components/UserRow';
import { EMPTY_LIST, exploreKey, loadList, usePosts } from '@/presentation/stores/postsStore';
import { colors, spacing } from '@/presentation/theme';

export default function ExploreScreen() {
  const list = usePosts((s) => s.lists[exploreKey]) ?? EMPTY_LIST;
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);

  useEffect(() => {
    void loadList(exploreKey, 'refresh');
  }, []);

  // DEBOUNCE: se busca 300 ms después de la última tecla, no en cada tecla.
  // El cleanup cancela el timer anterior; `active` descarta respuestas que llegan
  // tarde y desordenadas (buscar "an" no debe pisar el resultado de "ana").
  useEffect(() => {
    // Con la búsqueda vacía se muestra la grilla; no hace falta limpiar `results` (se ignora).
    if (!query.trim()) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const found = await profileRepository.search(query);
        if (active) setResults(found);
      } catch {}
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.search}>
        <TextField placeholder="Buscar" value={query} onChangeText={setQuery} style={styles.input} />
      </View>
      {query.trim() ? (
        <FlashList data={results} keyExtractor={(p) => p.id} renderItem={({ item }) => <UserRow profile={item} />} />
      ) : (
        <PostGrid
          ids={list.ids}
          refreshing={list.refreshing}
          onRefresh={() => loadList(exploreKey, 'refresh')}
          onEndReached={() => loadList(exploreKey, 'more')}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  search: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  input: { backgroundColor: colors.surface, borderWidth: 0, borderRadius: 10, height: 38 },
});
