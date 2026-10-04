import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { dmRepository, profileRepository } from '@/di/container';
import { canViewContent, type FollowStatus, type Profile, type ProfileStats } from '@/domain/entities/Profile';

import { EMPTY_LIST, loadList, usePosts, userKey } from '../stores/postsStore';
import { refreshMyProfile, useSession } from '../stores/sessionStore';
import { colors, spacing, typography } from '../theme';
import { Avatar } from './Avatar';
import { PostGrid } from './PostGrid';
import { SmallButton } from './SmallButton';

/** Perfil propio o ajeno. Misma pantalla; cambian los botones y la regla de privacidad. */
export function ProfileView({ userId }: { userId: string }) {
  const myId = useSession((s) => s.userId);
  const myProfile = useSession((s) => s.profile);
  const isMe = userId === myId;

  const [other, setOther] = useState<Profile | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [followStatus, setFollowStatus] = useState<FollowStatus>('none');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const list = usePosts((s) => s.lists[userKey(userId)]) ?? EMPTY_LIST;

  const profile = isMe ? myProfile : other;
  const canView = profile ? canViewContent(profile, myId, followStatus) : false;

  // useFocusEffect: se recarga cada vez que la pantalla vuelve a estar visible
  // (p. ej. al regresar de "Editar perfil" o tras aprobar una solicitud).
  //
  // Las 3 cargas son INDEPENDIENTES a propósito (Promise.allSettled en vez de Promise.all):
  // con Promise.all, si fallaba solo el contador, se perdía también el perfil y la
  // pantalla quedaba en blanco. Ahora el perfil se muestra aunque fallen las otras.
  const load = useCallback(
    async (isActive: () => boolean) => {
      const [p, s, f] = await Promise.allSettled([
        isMe ? refreshMyProfile().then(() => null) : profileRepository.getById(userId),
        profileRepository.getStats(userId),
        isMe ? Promise.resolve<FollowStatus>('accepted') : profileRepository.getFollowStatus(userId),
      ]);
      if (!isActive()) return; // la pantalla se desenfocó mientras esperábamos

      if (p.status === 'rejected') {
        setLoadError((p.reason as Error).message);
      } else {
        setLoadError(null);
        if (!isMe) {
          setOther(p.value);
          setNotFound(p.value === null);
        }
      }
      if (s.status === 'fulfilled') setStats(s.value);
      else console.warn('[perfil] contadores:', (s.reason as Error).message);
      if (f.status === 'fulfilled') setFollowStatus(f.value);
      else console.warn('[perfil] estado de seguimiento:', (f.reason as Error).message);
    },
    [userId, isMe],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load(() => active);
      return () => {
        active = false;
      };
    }, [load]),
  );

  // La grilla solo se pide si RLS nos va a dejar verla (evita una consulta inútil).
  useFocusEffect(
    useCallback(() => {
      if (canView) void loadList(userKey(userId), 'refresh');
    }, [canView, userId]),
  );

  const onFollowPress = async () => {
    if (followStatus !== 'none') {
      const isRequest = followStatus === 'pending';
      Alert.alert(
        isRequest ? 'Cancelar solicitud' : `Dejar de seguir a @${profile?.username}`,
        profile?.isPrivate && !isRequest ? 'Tendrás que volver a enviar una solicitud para ver sus publicaciones.' : undefined,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: isRequest ? 'Cancelar solicitud' : 'Dejar de seguir',
            style: 'destructive',
            onPress: () => runFollow(async () => {
              await profileRepository.unfollow(userId);
              return 'none';
            }),
          },
        ],
      );
      return;
    }
    await runFollow(() => profileRepository.follow(userId));
  };

  const openChat = async () => {
    try {
      // RPC: obtiene la conversación 1-a-1 existente o la crea (par canónico user_a < user_b).
      const conversationId = await dmRepository.getOrCreateConversation(userId);
      router.push(`/chat/${conversationId}`);
    } catch (e) {
      Alert.alert('No se pudo abrir el chat', (e as Error).message);
    }
  };

  // Seguir NO es optimista a propósito: el resultado (pending o accepted) lo decide el SERVIDOR
  // según la privacidad real de la cuenta, así que se espera su respuesta.
  const runFollow = async (action: () => Promise<FollowStatus>) => {
    setBusy(true);
    try {
      const status = await action();
      setFollowStatus(status);
      setStats(await profileRepository.getStats(userId));
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!profile) {
    // Nunca una pantalla vacía: cargando, no encontrado o error visible con reintento.
    return (
      <View style={styles.status}>
        <Stack.Screen options={{ title: '' }} />
        {loadError ? (
          <>
            <Text style={typography.title}>No se pudo cargar el perfil</Text>
            <Text style={[typography.caption, { textAlign: 'center' }]}>{loadError}</Text>
            <SmallButton title="Reintentar" onPress={() => void load(() => true)} />
          </>
        ) : notFound ? (
          <Text style={typography.title}>Este usuario no existe</Text>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  const followLabel = followStatus === 'accepted' ? 'Siguiendo' : followStatus === 'pending' ? 'Solicitado' : 'Seguir';

  const header = (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <Avatar uri={profile.avatarUrl} size={86} />
        <View style={styles.stats}>
          <Stat value={stats?.posts} label="publicaciones" />
          <StatLink value={stats?.followers} label="seguidores" href={`/follows/${userId}?kind=followers`} enabled={canView} />
          <StatLink value={stats?.following} label="seguidos" href={`/follows/${userId}?kind=following`} enabled={canView} />
        </View>
      </View>
      {profile.fullName ? <Text style={typography.username}>{profile.fullName}</Text> : null}
      {profile.bio ? <Text style={typography.body}>{profile.bio}</Text> : null}
      <View style={styles.buttons}>
        {isMe ? (
          <Link href="/edit" asChild>
            <Pressable style={styles.editBtn}>
              <Text style={styles.editText}>Editar perfil</Text>
            </Pressable>
          </Link>
        ) : (
          <>
            <SmallButton
              title={followLabel}
              variant={followStatus === 'none' ? 'primary' : 'secondary'}
              onPress={onFollowPress}
              loading={busy}
              flex
            />
            <SmallButton title="Mensaje" onPress={openChat} flex />
          </>
        )}
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: profile.username,
          headerTitle: () => (
            <View style={styles.title}>
              {profile.isPrivate ? <Ionicons name="lock-closed" size={14} color={colors.text} /> : null}
              <Text style={typography.title}>{profile.username}</Text>
            </View>
          ),
        }}
      />
      {canView ? (
        <PostGrid
          ids={list.ids}
          header={header}
          refreshing={list.refreshing}
          onRefresh={() => loadList(userKey(userId), 'refresh')}
          onEndReached={() => loadList(userKey(userId), 'more')}
          empty={!list.refreshing ? <Text style={styles.empty}>Aún no hay publicaciones</Text> : undefined}
        />
      ) : (
        <View style={{ flex: 1 }}>
          {header}
          <View style={styles.locked}>
            <Ionicons name="lock-closed-outline" size={48} color={colors.text} />
            <Text style={typography.title}>Esta cuenta es privada</Text>
            <Text style={typography.caption}>Sigue esta cuenta para ver sus fotos.</Text>
          </View>
        </View>
      )}
    </>
  );
}

function Stat({ value, label }: { value?: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={typography.title}>{value ?? '–'}</Text>
      <Text style={typography.body}>{label}</Text>
    </View>
  );
}

function StatLink({ value, label, href, enabled }: { value?: number; label: string; href: `/follows/${string}`; enabled: boolean }) {
  if (!enabled) return <Stat value={value} label={label} />;
  return (
    <Link href={href} asChild>
      <Pressable>
        <Stat value={value} label={label} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  status: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  header: { padding: spacing.lg, gap: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  stats: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  editBtn: { flex: 1, height: 32, borderRadius: 8, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  editText: { fontWeight: '600' },
  title: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locked: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.xl },
});
