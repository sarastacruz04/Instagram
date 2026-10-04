import { FlashList } from '@shopify/flash-list';
import { Link, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { timeAgo } from '@/core/format';
import { activityRepository, profileRepository } from '@/di/container';
import type { ActivityItem } from '@/domain/entities/Post';
import type { Profile } from '@/domain/entities/Profile';
import { Avatar } from '@/presentation/components/Avatar';
import { MediaImage } from '@/presentation/components/MediaImage';
import { SmallButton } from '@/presentation/components/SmallButton';
import { UserRow } from '@/presentation/components/UserRow';
import { useSession } from '@/presentation/stores/sessionStore';
import { colors, spacing, typography } from '@/presentation/theme';

export default function ActivityScreen() {
  const myId = useSession((s) => s.userId);
  const [requests, setRequests] = useState<Profile[]>([]);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [r, a] = await Promise.all([profileRepository.getPendingRequests(), activityRepository.getActivity()]);
      setRequests(r);
      setItems(a);
    } catch {
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Realtime: una solicitud nueva aparece sin recargar la pantalla.
  useEffect(() => {
    if (!myId) return;
    return profileRepository.subscribeToRequests(myId, () => void load());
  }, [myId, load]);

  // Aprobar/rechazar: se quita de la lista al instante (optimista) y se revierte si falla.
  const respond = async (person: Profile, accept: boolean) => {
    setRequests((list) => list.filter((p) => p.id !== person.id));
    try {
      if (accept) await profileRepository.acceptRequest(person.id);
      else await profileRepository.rejectRequest(person.id);
    } catch (e) {
      setRequests((list) => [person, ...list]);
      Alert.alert('Error', (e as Error).message);
    }
  };

  const header = requests.length ? (
    <View>
      <Text style={styles.section}>Solicitudes de seguimiento</Text>
      {requests.map((p) => (
        <UserRow
          key={p.id}
          profile={p}
          right={
            <View style={styles.actions}>
              <SmallButton title="Confirmar" variant="primary" onPress={() => respond(p, true)} />
              <SmallButton title="Eliminar" onPress={() => respond(p, false)} />
            </View>
          }
        />
      ))}
      <Text style={styles.section}>Recientes</Text>
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Notificaciones' }} />
      <FlashList
        data={items}
        keyExtractor={(i) => `${i.kind}-${i.actorId}-${i.postId}-${i.createdAt}`}
        renderItem={({ item }) => <ActivityRow item={item} />}
        ListHeaderComponent={header}
        refreshing={refreshing}
        onRefresh={load}
        ListEmptyComponent={!refreshing && !requests.length ? <Text style={styles.empty}>Sin actividad todavía.</Text> : null}
      />
    </View>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const text = item.kind === 'like' ? 'le gustó tu publicación.' : `comentó: ${item.body}`;
  return (
    <Link href={`/post/${item.postId}`} asChild>
      <Pressable style={styles.row}>
        <Avatar uri={item.avatarUrl} size={44} />
        <Text style={[typography.body, { flex: 1 }]} numberOfLines={2}>
          <Text style={typography.username}>{item.username} </Text>
          {text} <Text style={typography.caption}>{timeAgo(item.createdAt)}</Text>
        </Text>
        <MediaImage path={item.imagePath} size={44} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  section: { ...typography.title, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.xl },
});
