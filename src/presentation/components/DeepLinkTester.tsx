import * as Linking from 'expo-linking';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { EMPTY_LIST, feedKey, usePosts } from '../stores/postsStore';
import { colors, spacing, typography } from '../theme';

/**
 * Prueba de deep linking DENTRO de Expo Go. Las apps de mensajería solo hacen clickeables los
 * links http(s), así que un `exp://…` o `instagramclone://…` compartido por WhatsApp no llega a
 * la app. Linking.openURL lanza el link como un INTENT del sistema operativo (igual que si lo
 * abriera otra app): Android se lo entrega a Expo Go → +native-intent.tsx → router.
 */
export function DeepLinkTester() {
  const firstPostId = usePosts((s) => (s.lists[feedKey] ?? EMPTY_LIST).ids[0]);

  const open = async () => {
    if (!firstPostId) {
      Alert.alert('Sin posts', 'Abre el feed primero para tener un post de prueba.');
      return;
    }
    const url = Linking.createURL(`post/${firstPostId}`); // exp://…/--/post/<id> en Expo Go
    try {
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('No se pudo abrir', `${url}\n\n${(e as Error).message}`);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={typography.username}>Deep linking</Text>
      <Text style={typography.caption}>
        Lanza el enlace del primer post del feed como un intent del sistema. Debe abrir ese post en la pestaña Home.
      </Text>
      <Pressable onPress={open} style={styles.chip}>
        <Text style={styles.chipText}>Abrir deep link de prueba</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 8,
    padding: spacing.md, gap: spacing.xs,
  },
  chip: {
    alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: 8,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.xs,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
});
