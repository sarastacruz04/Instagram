import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSyncStatus } from '../stores/syncStore';

/**
 * Aviso flotante de conectividad. Es posicionado en absoluto (no empuja el layout) y
 * pointerEvents="none" (no roba toques). Cada selector devuelve un primitivo, así que
 * el banner solo se re-renderiza cuando cambia online/pending, no en cada evento del motor.
 */
export function SyncBanner() {
  const online = useSyncStatus((s) => s.online);
  const pending = useSyncStatus((s) => s.pending);
  const insets = useSafeAreaInsets();

  if (online && pending === 0) return null;

  const text = !online
    ? `Sin conexión${pending ? ` · ${pending} ${pending === 1 ? 'acción pendiente' : 'acciones pendientes'}` : ''}`
    : `Sincronizando ${pending}…`;

  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 56 }]}>
      <View style={[styles.pill, { backgroundColor: online ? '#262626' : '#ED4956' }]}>
        <Text style={styles.text}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  text: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
