import { Pressable, StyleSheet, Text, View } from 'react-native';

import { newId } from '@/core/ids';
import { syncQueue } from '@/di/container';

import { useSyncStatus } from '../stores/syncStore';
import { colors, spacing, typography } from '../theme';

/**
 * Panel para DEMOSTRAR la cola offline durante la defensa:
 *  - Modo avión + "5 likes" → pendientes = 1 (coalescencia: solo sobrevive la última intención).
 *  - Modo avión + "comentario" varias veces → pendientes crece; al volver la red se procesan en orden.
 *  - Los posts de prueba NO existen → el servidor los rechaza (RLS/FK) → pasan a "fallidas"
 *    en vez de reintentarse para siempre (clasificación de errores permanentes).
 */
export function SyncDiagnostics() {
  const { online, pending, failed, syncing } = useSyncStatus();

  const enqueueLikes = async () => {
    const postId = newId();
    for (let i = 0; i < 5; i++) {
      await syncQueue.enqueue({ type: 'SET_LIKE', payload: { postId, liked: i % 2 === 0 } });
    }
  };

  const enqueueComment = () =>
    syncQueue.enqueue({
      type: 'ADD_COMMENT',
      payload: { id: newId(), postId: newId(), parentId: null, body: `Prueba ${new Date().toLocaleTimeString()}` },
    });

  return (
    <View style={styles.card}>
      <Text style={typography.username}>Cola de sincronización</Text>
      <Text style={typography.caption}>
        {online ? 'En línea' : 'Sin conexión'} · pendientes {pending} · fallidas {failed}
        {syncing ? ' · sincronizando…' : ''}
      </Text>
      <View style={styles.row}>
        <Chip label="5 likes al mismo post" onPress={enqueueLikes} />
        <Chip label="Comentario" onPress={enqueueComment} />
        <Chip label="Limpiar fallidas" onPress={() => syncQueue.clearFailed()} />
      </View>
    </View>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 8,
    padding: spacing.md, gap: spacing.sm,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipText: { fontSize: 13, fontWeight: '600' },
});
