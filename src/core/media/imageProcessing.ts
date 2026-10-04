import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

const MAX_WIDTH = 1080; // ancho estándar de Instagram

/** Abre la galería con recorte en la proporción dada. Devuelve la URI local o null si se canceló. */
async function pickImage(aspect: [number, number]): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect,
    quality: 1, // sin pérdida aquí: la compresión se hace una sola vez, abajo
  });
  return result.canceled ? null : result.assets[0].uri;
}

/** Posts y avatares: cuadrado 1:1. */
export const pickSquareImage = () => pickImage([1, 1]);
/** Historias: vertical 9:16 (pantalla completa del celular). */
export const pickStoryImage = () => pickImage([9, 16]);

/**
 * Redimensiona a 1080 px y comprime a JPEG 80 %. Una foto de cámara (4000×3000, ~5 MB)
 * queda en ~200-400 KB: sube más rápido, ocupa menos en Storage y en el caché del resto de
 * usuarios, y al decodificarla ocupa ~4.6 MB de RAM (1080×1080×4 bytes) en vez de ~48 MB.
 *
 * HILOS: decodificar, escalar y codificar son operaciones pesadas de CPU que corren en un
 * hilo nativo de fondo. El hilo JS solo espera la Promise.
 */
export async function compressForUpload(uri: string, maxWidth = MAX_WIDTH): Promise<string> {
  const image = await ImageManipulator.manipulate(uri).resize({ width: maxWidth }).renderAsync();
  try {
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    return saved.uri;
  } finally {
    // `image` es un SharedRef: el bitmap vive en memoria NATIVA, fuera del recolector de basura
    // de JS. release() lo libera ya, sin esperar a que el GC recolecte el objeto JS.
    image.release();
  }
}
