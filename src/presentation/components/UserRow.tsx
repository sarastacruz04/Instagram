import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Profile } from '@/domain/entities/Profile';

import { colors, spacing, typography } from '../theme';
import { Avatar } from './Avatar';

export function UserRow({ profile, right }: { profile: Profile; right?: ReactNode }) {
  return (
    <View style={styles.row}>
      <Link href={`/user/${profile.id}`} asChild>
        <Pressable style={styles.left}>
          <Avatar uri={profile.avatarUrl} size={44} />
          <View style={{ flexShrink: 1 }}>
            <Text style={typography.username}>{profile.username}</Text>
            {profile.fullName ? <Text style={styles.sub}>{profile.fullName}</Text> : null}
          </View>
        </Pressable>
      </Link>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sub: { color: colors.textSecondary, fontSize: 14 },
});
