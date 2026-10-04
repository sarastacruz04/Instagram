import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ImageCacheStats } from '@/core/cache/ImageCache';
import { imageCache } from '@/di/container';

import { colors, spacing, typography } from '../theme';

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Panel para DEMOSTRAR el motor de caché en la defensa:
 *  - Scroll por el feed → sube "red"; volver arriba → sube "RAM" (aciertos L1).
 *  - "Vaciar RAM" y volver al feed → sube "disco" (L2): la imagen no se vuelve a descargar.
 *  - Scroll MUY rápido → sube "canceladas" (celdas que salieron antes de cargar).
 */
export function ImageCacheDiagnostics() {
  const [stats, setStats] = useState<ImageCacheStats>(() => imageCache.getStats());
  const [disk, setDisk] = useState({ bytes: 0, files: 0, budget: 0 });

  // Sondeo cada segundo solo mientras el panel está montado (el cleanup detiene el timer).
  useEffect(() => {
    let active = true;
    const tick = async () => {
      const d = await imageCache.getDiskStats();
      if (!active) return;
      setStats(imageCache.getStats());
      setDisk(d);
    };
    void tick();
    const id = setInterval(tick, 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <View style={styles.card}>
      <Text style={typography.username}>Caché de imágenes</Text>
      <Text style={typography.caption}>
        RAM (L1): {mb(stats.memoryBytes)} / {mb(imageCache.memoryBudget)} · {stats.memoryItems} bitmaps · {stats.pinned} en
        pantalla
      </Text>
      <Text style={typography.caption}>
        Disco (L2): {mb(disk.bytes)} / {mb(disk.budget)} · {disk.files} archivos
      </Text>
      <Text style={typography.caption}>
        Aciertos RAM {stats.memoryHits} · disco {stats.diskHits} · red {stats.networkLoads} · deduplicadas{' '}
        {stats.deduplicated}
      </Text>
      <Text style={typography.caption}>
        Canceladas {stats.cancelled} · en curso {stats.inFlight} · desalojos RAM {stats.memoryEvictions} · disco{' '}
        {stats.diskEvictions}
      </Text>
      <View style={styles.row}>
        <Chip
          label="Vaciar RAM"
          onPress={() => {
            const freed = imageCache.trimMemory(0);
            const left = imageCache.getStats();
            Alert.alert(
              'RAM liberada',
              `${freed} bitmaps liberados. ${left.pinned} siguen en RAM porque están en pantalla ahora mismo ` +
                '(la LRU nunca desaloja lo que se está mostrando).',
            );
            setStats(left);
          }}
        />
        <Chip label="Vaciar disco" onPress={() => void imageCache.clearDisk()} />
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
    padding: spacing.md, gap: spacing.xs,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: { backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipText: { fontSize: 13, fontWeight: '600' },
});
