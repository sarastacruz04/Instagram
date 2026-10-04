import { Directory, File, Paths } from 'expo-file-system';

/**
 * Copia una imagen a almacenamiento PERSISTENTE para una subida diferida (cola offline).
 * Paths.document persiste hasta desinstalar la app; Paths.cache lo puede vaciar el SO
 * antes de que vuelva la red. La copia se hace en un hilo nativo.
 */
export async function persistPendingFile(id: string, sourceUri: string): Promise<string> {
  const dir = new Directory(Paths.document, 'pending-uploads');
  dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `${id}.jpg`);
  await new File(sourceUri).copy(dest, { overwrite: true });
  return dest.uri;
}
