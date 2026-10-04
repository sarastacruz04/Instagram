import { Image, type ImageRef } from 'expo-image';
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { PixelRatio, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { ImageHandle } from '@/core/cache/ImageCache';
import { imageCache, mediaRepository } from '@/di/container';

import { colors } from '../theme';

export interface CachedImageProps {
  /** Llave estable: ruta del bucket privado (kind 'media') o URL pública (kind 'url'). */
  cacheKey: string;
  kind: 'media' | 'url';
  /** Ancho en puntos de layout; se convierte a píxeles físicos para decodificar justo a ese tamaño. */
  width: number;
  style: StyleProp<ViewStyle>;
  /** false cuando la celda salió del viewport: si la imagen aún no llegó, se CANCELA la carga. */
  visible?: boolean;
  /** Archivo local (post creado offline): se muestra directo, sin pasar por la red. */
  localUri?: string;
  rounded?: boolean;
}

/**
 * Imagen servida por NUESTRO motor de caché (RAM + disco + red), no por el caché automático
 * de una librería. expo-image solo se usa para PINTAR un bitmap que ya decodificamos (ImageRef).
 *
 * Ciclo de vida = gestión de memoria:
 *  - Montaje / cambio de imagen → acquire() con un AbortController nuevo.
 *  - Cleanup del efecto (FlashList RECICLA la celda para otro post, la celda se desmonta, o sale
 *    del viewport antes de cargar) → abort() cancela la descarga + release() suelta el bitmap.
 */
export function CachedImage({ cacheKey, kind, width, style, visible = true, localUri, rounded }: CachedImageProps) {
  const px = PixelRatio.getPixelSizeForLayoutSize(width);
  const requestKey = `${cacheKey}@${px}`;
  // Las pestañas NO se desmontan al cambiar de pestaña: sin esto, el feed y Explorar seguirían
  // FIJANDO sus bitmaps en RAM aunque nadie los esté viendo, y la LRU no podría desalojarlos.
  const focused = useIsFocused();

  // Se guarda el bitmap JUNTO con la llave para la que se pidió: si la celda se recicla con
  // otra imagen, `loaded.key !== requestKey` y nunca se pinta el bitmap del post anterior.
  const [loaded, setLoaded] = useState<{ key: string; ref: ImageRef } | null>(null);
  const isLoaded = loaded?.key === requestKey;

  // Una vez cargada, seguir mostrándola aunque salga del viewport (ya no cuesta red).
  // Si sale ANTES de cargar, shouldLoad pasa a false → el cleanup cancela la descarga.
  // Si la PANTALLA pierde el foco, se suelta el bitmap; al volver se pide de nuevo
  // (normalmente acierto en RAM o disco, en milisegundos).
  const shouldLoad = !localUri && focused && (visible || isLoaded);

  useEffect(() => {
    if (!shouldLoad) return;
    const controller = new AbortController();
    let handle: ImageHandle | null = null;
    const resolveUrl = kind === 'media' ? () => mediaRepository.getSignedUrl(cacheKey) : () => Promise.resolve(cacheKey);

    imageCache
      .acquire(cacheKey, resolveUrl, px, controller.signal)
      .then((h) => {
        handle = h;
        setLoaded({ key: `${cacheKey}@${px}`, ref: h.ref });
      })
      .catch(() => {}); // AbortError (esperado) o sin acceso: se queda el placeholder gris

    return () => {
      controller.abort(); // cancela la descarga si todavía estaba en curso
      if (handle) {
        handle.release(); // suelta el bitmap: la LRU ya lo puede desalojar (y liberar)
        // Olvidar la referencia: tras soltarla, el bitmap puede liberarse en cualquier momento,
        // así que NUNCA se debe volver a pintar. Al recuperar el foco se pide uno válido.
        setLoaded(null);
      }
    };
  }, [cacheKey, kind, px, shouldLoad]);

  const radius = rounded ? { borderRadius: width / 2, overflow: 'hidden' as const } : null;

  return (
    <View style={[styles.bg, style, radius]}>
      {localUri ? (
        // cachePolicy="none": es un archivo local; no queremos que expo-image lo duplique en su caché.
        <Image source={{ uri: localUri }} cachePolicy="none" style={StyleSheet.absoluteFill} />
      ) : isLoaded ? (
        <Image source={loaded.ref} style={StyleSheet.absoluteFill} transition={120} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { backgroundColor: colors.surface },
});
