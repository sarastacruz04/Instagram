import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  flex?: boolean;
}

/** Botón compacto de Instagram: azul (Seguir) o gris (Siguiendo / Editar perfil). */
export function SmallButton({ title, onPress, variant = 'secondary', loading, flex }: Props) {
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={[styles.btn, flex && { flex: 1 }, { backgroundColor: primary ? colors.primary : colors.surface }]}>
      {loading ? (
        <ActivityIndicator size="small" color={primary ? '#fff' : colors.text} />
      ) : (
        <Text style={[styles.text, { color: primary ? '#fff' : colors.text }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { height: 32, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '600', fontSize: 14 },
});
