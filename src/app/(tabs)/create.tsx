import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { compressForUpload, pickSquareImage } from '@/core/media/imageProcessing';
import { PrimaryButton } from '@/presentation/components/PrimaryButton';
import { createPost } from '@/presentation/stores/postsStore';
import { colors, spacing, typography } from '@/presentation/theme';

export default function CreateScreen() {
  const [uri, setUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const picked = await pickSquareImage();
    if (!picked) return;
    setBusy(true);
    try {
      setUri(await compressForUpload(picked));
    } catch (e) {
      Alert.alert('No se pudo procesar la imagen', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!uri) return;
    setBusy(true);
    try {
      // No espera a la red: guarda la imagen y la intención y vuelve al feed, donde el post
      // ya aparece con "Publicando…". La subida la hace el SyncEngine (con o sin internet ahora).
      await createPost(uri, caption.trim());
      setUri(null);
      setCaption('');
      router.navigate('/');
    } catch (e) {
      Alert.alert('No se pudo publicar', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.bar}>
          <Text style={typography.title}>Nueva publicación</Text>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={pick} style={styles.picker} disabled={busy}>
            {uri ? (
              <Image source={{ uri }} style={styles.preview} />
            ) : (
              <View style={styles.placeholder}>
                <Ionicons name="images-outline" size={48} color={colors.textSecondary} />
                <Text style={typography.caption}>Toca para elegir una foto</Text>
              </View>
            )}
          </Pressable>
          <TextInput
            placeholder="Escribe una descripción…"
            placeholderTextColor={colors.textSecondary}
            value={caption}
            onChangeText={setCaption}
            multiline
            maxLength={2200}
            style={styles.caption}
          />
          <PrimaryButton title="Compartir" onPress={publish} disabled={!uri} loading={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  bar: { alignItems: 'center', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  content: { padding: spacing.lg, gap: spacing.lg },
  picker: { aspectRatio: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surface },
  preview: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  caption: { minHeight: 80, fontSize: 15, textAlignVertical: 'top', color: colors.text },
});
