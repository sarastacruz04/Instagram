import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { compressForUpload, pickSquareImage } from '@/core/media/imageProcessing';
import { authRepository, profileRepository } from '@/di/container';
import { Avatar } from '@/presentation/components/Avatar';
import { DeepLinkTester } from '@/presentation/components/DeepLinkTester';
import { ImageCacheDiagnostics } from '@/presentation/components/ImageCacheDiagnostics';
import { PrimaryButton } from '@/presentation/components/PrimaryButton';
import { SyncDiagnostics } from '@/presentation/components/SyncDiagnostics';
import { TextField } from '@/presentation/components/TextField';
import { refreshMyProfile, updateMyProfile, useSession } from '@/presentation/stores/sessionStore';
import { colors, spacing, typography } from '@/presentation/theme';

export default function EditProfileScreen() {
  const profile = useSession((s) => s.profile);
  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [isPrivate, setIsPrivate] = useState(profile?.isPrivate ?? false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  if (!profile) return null;

  const changeAvatar = async () => {
    const picked = await pickSquareImage();
    if (!picked) return;
    setUploading(true);
    try {
      const small = await compressForUpload(picked, 320); // un avatar no necesita 1080 px
      await profileRepository.uploadAvatar(profile.id, small);
      await refreshMyProfile();
    } catch (e) {
      Alert.alert('No se pudo cambiar la foto', (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  // Optimista + cola offline: no espera a la red. El perfil cambia ya y se sincroniza después.
  // (La foto NO va por la cola: es una subida cuyo resultado —la URL nueva— lo da el servidor.)
  const save = async () => {
    setSaving(true);
    try {
      await updateMyProfile({ fullName: fullName.trim(), bio: bio.trim(), isPrivate });
      router.back();
    } catch (e) {
      Alert.alert('No se pudo guardar', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Editar perfil' }} />
      <Pressable onPress={changeAvatar} style={styles.avatar} disabled={uploading}>
        <Avatar uri={profile.avatarUrl} size={86} />
        <Text style={styles.link}>{uploading ? 'Subiendo…' : 'Cambiar foto'}</Text>
      </Pressable>

      <Text style={typography.caption}>Nombre</Text>
      <TextField value={fullName} onChangeText={setFullName} autoCapitalize="words" />
      <Text style={typography.caption}>Presentación</Text>
      <TextField value={bio} onChangeText={setBio} multiline style={{ height: 80, paddingTop: 10 }} autoCapitalize="sentences" />

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={typography.username}>Cuenta privada</Text>
          <Text style={typography.caption}>
            Solo tus seguidores aprobados verán tus fotos y tus listas de seguidores. La regla se aplica en el
            servidor (RLS).
          </Text>
        </View>
        <Switch value={isPrivate} onValueChange={setIsPrivate} />
      </View>

      <PrimaryButton title="Guardar" onPress={save} loading={saving} />

      <SyncDiagnostics />
      <ImageCacheDiagnostics />
      <DeepLinkTester />

      <Pressable onPress={() => authRepository.signOut()} style={styles.logout}>
        <Text style={{ color: colors.like, fontWeight: '600' }}>Cerrar sesión</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.background },
  avatar: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  link: { color: colors.primary, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.md },
  logout: { alignItems: 'center', padding: spacing.lg },
});
