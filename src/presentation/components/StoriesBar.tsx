import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { compressForUpload, pickStoryImage } from '@/core/media/imageProcessing';
import type { StoryGroup } from '@/domain/entities/Story';

import { useSession } from '../stores/sessionStore';
import { createStory, useStories } from '../stores/storiesStore';
import { colors, spacing } from '../theme';
import { Avatar } from './Avatar';

const SIZE = 64;
const RING = ['#FEDA75', '#FA7E1E', '#D62976', '#962FBF', '#4F5BD5'] as const;

/** Fila horizontal de avatares sobre el feed. */
export function StoriesBar() {
  const groups = useStories((s) => s.groups);
  const me = useSession((s) => s.profile);
  const myGroup = groups.find((g) => g.authorId === me?.id);
  const others = groups.filter((g) => g.authorId !== me?.id);

  const addStory = async () => {
    const picked = await pickStoryImage();
    if (!picked) return;
    try {
      await createStory(await compressForUpload(picked));
    } catch (e) {
      Alert.alert('No se pudo crear la historia', (e as Error).message);
    }
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {/* "Tu historia": tocar → ver (si hay) o crear; el "+" siempre crea. */}
      <View style={styles.item}>
        <Pressable onPress={() => (myGroup ? openStories(myGroup) : addStory())} onLongPress={addStory}>
          <Ring group={myGroup}>
            <Avatar uri={me?.avatarUrl ?? null} size={SIZE} />
          </Ring>
          <Pressable onPress={addStory} style={styles.plus} hitSlop={6}>
            <Ionicons name="add" size={16} color="#fff" />
          </Pressable>
        </Pressable>
        <Text style={styles.name} numberOfLines={1}>
          Tu historia
        </Text>
      </View>

      {others.map((g) => (
        <View key={g.authorId} style={styles.item}>
          <Pressable onPress={() => openStories(g)}>
            <Ring group={g}>
              <Avatar uri={g.avatarUrl} size={SIZE} />
            </Ring>
          </Pressable>
          <Text style={[styles.name, g.allSeen && { color: colors.textSecondary }]} numberOfLines={1}>
            {g.username}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

function openStories(group: StoryGroup) {
  router.push(`/stories/${group.authorId}`);
}

/** Anillo de colores si hay historias SIN VER; gris si ya se vieron todas; nada si no hay. */
function Ring({ group, children }: { group?: StoryGroup; children: React.ReactNode }) {
  if (!group) return <View style={styles.ringPad}>{children}</View>;
  if (group.allSeen) return <View style={[styles.ringPad, styles.seenRing]}>{children}</View>;
  return (
    <LinearGradient colors={RING} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.gradient}>
      <View style={styles.gap}>{children}</View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md },
  item: { width: SIZE + 10, alignItems: 'center', gap: 4 },
  name: { fontSize: 12, maxWidth: SIZE + 10 },
  gradient: { padding: 3, borderRadius: (SIZE + 10) / 2 },
  gap: { padding: 2, borderRadius: (SIZE + 4) / 2, backgroundColor: colors.background },
  ringPad: { padding: 5 },
  seenRing: { padding: 3, borderRadius: (SIZE + 10) / 2, borderWidth: 2, borderColor: colors.border },
  plus: {
    position: 'absolute', right: 2, bottom: 2, width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
});
