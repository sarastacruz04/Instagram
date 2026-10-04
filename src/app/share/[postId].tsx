import { FlashList } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { dmRepository, profileRepository } from '@/di/container';
import { postReference } from '@/domain/entities/Message';
import type { Profile } from '@/domain/entities/Profile';
import { SmallButton } from '@/presentation/components/SmallButton';
import { TextField } from '@/presentation/components/TextField';
import { UserRow } from '@/presentation/components/UserRow';
import { loadInbox, sendMessage, useDm } from '@/presentation/stores/dmStore';
import { useSession } from '@/presentation/stores/sessionStore';
import { colors, spacing } from '@/presentation/theme';

/** Compartir un post por mensaje directo = "referencia interna" (Módulo 1). */
export default function SharePostScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const myId = useSession((s) => s.userId);
  const inbox = useDm((s) => s.inbox);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);

  useEffect(() => {
    void loadInbox();
  }, []);

  useEffect(() => {
    if (!query.trim()) return;
    let active = true;
    const t = setTimeout(() => {
      profileRepository.search(query).then((r) => active && setResults(r)).catch(() => {});
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);

  // Recientes (bandeja) o resultados de búsqueda, sin incluirme a mí.
  const people: Profile[] = query.trim()
    ? results.filter((p) => p.id !== myId)
    : inbox.map((c) => ({ id: c.otherId, username: c.username, avatarUrl: c.avatarUrl, fullName: '', bio: '', isPrivate: false }));

  const sendTo = async (person: Profile) => {
    try {
      const conversationId = await dmRepository.getOrCreateConversation(person.id);
      // Se envía por la MISMA cola offline que cualquier mensaje: funciona aunque no haya red.
      await sendMessage(conversationId, postReference(postId));
      router.back();
    } catch (e) {
      Alert.alert('No se pudo enviar', (e as Error).message);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Enviar a' }} />
      <View style={styles.search}>
        <TextField placeholder="Buscar" value={query} onChangeText={setQuery} />
      </View>
      <FlashList
        data={people}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <UserRow profile={item} right={<SmallButton title="Enviar" variant="primary" onPress={() => sendTo(item)} />} />
        )}
        ListEmptyComponent={<Text style={styles.empty}>Busca a alguien para enviarle la publicación.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  search: { padding: spacing.md },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.xl },
});
