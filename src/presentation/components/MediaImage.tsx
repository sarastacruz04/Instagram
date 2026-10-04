import type { StyleProp, ViewStyle } from 'react-native';

import { CachedImage } from './CachedImage';

interface Props {
  /** Ruta en el bucket privado (llave estable del caché). */
  path: string;
  /** Archivo local (post creado offline aún sin subir). */
  localUri?: string;
  /** Tamaño de la imagen en puntos (cuadrada). */
  size: number;
  style?: StyleProp<ViewStyle>;
  visible?: boolean;
}

/** Imagen de un post / historia (bucket privado → URL firmada → motor de caché). */
export function MediaImage({ path, localUri, size, style, visible }: Props) {
  return (
    <CachedImage
      cacheKey={path}
      kind="media"
      width={size}
      style={[{ width: size, height: size }, style]}
      visible={visible}
      localUri={localUri}
    />
  );
}
