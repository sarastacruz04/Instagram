import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authRepository } from '@/di/container';
import { PrimaryButton } from '@/presentation/components/PrimaryButton';
import { TextField } from '@/presentation/components/TextField';
import { colors, spacing, typography } from '@/presentation/theme';

export default function LoginScreen() {
  // Estado LOCAL del formulario: solo le importa a esta pantalla, no va al store global.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setLoading(true);
    try {
      await authRepository.signIn(email, password);
      // No navegamos a mano: el cambio de sesión actualiza el store y Stack.Protected
      // cambia las rutas disponibles. La navegación se DERIVA del estado.
    } catch (e) {
      Alert.alert('No se pudo iniciar sesión', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <Text style={[typography.logo, styles.logo]}>Instagram</Text>
        <View style={styles.form}>
          <TextField placeholder="Correo electrónico" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <TextField placeholder="Contraseña" secureTextEntry value={password} onChangeText={setPassword} />
          <PrimaryButton title="Entrar" onPress={onSubmit} loading={loading} disabled={!email || password.length < 6} />
        </View>
      </KeyboardAvoidingView>
      <View style={styles.footer}>
        <Text style={typography.body}>¿No tienes cuenta? </Text>
        <Link href="/register" style={styles.link}>Regístrate</Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  logo: { textAlign: 'center', marginBottom: spacing.xl, fontSize: 40 },
  form: { gap: spacing.sm },
  footer: {
    flexDirection: 'row', justifyContent: 'center', paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  link: { color: colors.primary, fontWeight: '600' },
});
