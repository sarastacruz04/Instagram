import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authRepository, profileRepository } from '@/di/container';
import { PrimaryButton } from '@/presentation/components/PrimaryButton';
import { TextField } from '@/presentation/components/TextField';
import { colors, spacing, typography } from '@/presentation/theme';

const USERNAME_RE = /^[a-z0-9._]{3,30}$/; // misma regla que el CHECK de Postgres

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const validUsername = USERNAME_RE.test(username.toLowerCase());

  const onSubmit = async () => {
    setLoading(true);
    try {
      if (!(await profileRepository.isUsernameAvailable(username))) {
        Alert.alert('Nombre de usuario ocupado', 'Prueba con otro.');
        return;
      }
      await authRepository.signUp({ email, password, username, fullName });
    } catch (e) {
      Alert.alert('No se pudo crear la cuenta', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={[typography.logo, styles.logo]}>Instagram</Text>
          <Text style={styles.subtitle}>Regístrate para ver fotos de tus amigos.</Text>
          <View style={styles.form}>
            <TextField placeholder="Correo electrónico" keyboardType="email-address" value={email} onChangeText={setEmail} />
            <TextField placeholder="Nombre completo" autoCapitalize="words" value={fullName} onChangeText={setFullName} />
            <TextField placeholder="Nombre de usuario" value={username} onChangeText={setUsername} />
            {username.length > 0 && !validUsername ? (
              <Text style={styles.error}>3–30 caracteres: letras minúsculas, números, punto o guion bajo.</Text>
            ) : null}
            <TextField placeholder="Contraseña" secureTextEntry value={password} onChangeText={setPassword} />
            <PrimaryButton
              title="Registrarte"
              onPress={onSubmit}
              loading={loading}
              disabled={!email || !validUsername || password.length < 6}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={styles.footer}>
        <Text style={typography.body}>¿Tienes una cuenta? </Text>
        <Link href="/login" style={styles.link}>Inicia sesión</Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  logo: { textAlign: 'center', fontSize: 40 },
  subtitle: { textAlign: 'center', color: colors.textSecondary, fontWeight: '600', marginVertical: spacing.lg },
  form: { gap: spacing.sm },
  error: { color: colors.like, fontSize: 12 },
  footer: {
    flexDirection: 'row', justifyContent: 'center', paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  link: { color: colors.primary, fontWeight: '600' },
});
