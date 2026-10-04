import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { colors } from '../theme';
import { CachedImage } from './CachedImage';

/** Foto de perfil (bucket público `avatars`), también servida por el motor de caché propio. */
export function Avatar({ uri, size = 32 }: { uri: string | null; size?: number }) {
  if (!uri) {
    return (
      <View
        style={{
          width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface,
          alignItems: 'center', justifyContent: 'center',
        }}>
        <Ionicons name="person" size={size * 0.6} color={colors.textSecondary} />
      </View>
    );
  }
  // La URL pública (con ?v=) ES la llave: si cambia la foto, cambia la llave.
  return <CachedImage cacheKey={uri} kind="url" width={size} style={{ width: size, height: size }} rounded />;
}
