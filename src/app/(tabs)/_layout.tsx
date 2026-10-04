import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { SyncBanner } from '@/presentation/components/SyncBanner';
import { colors } from '@/presentation/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function icon(active: IconName, inactive: IconName) {
  function TabIcon({ focused }: { focused: boolean }) {
    return <Ionicons name={focused ? active : inactive} size={26} color={colors.text} />;
  }
  return TabIcon;
}

// Barra inferior persistente. Cada pestaña es un NAVEGADOR independiente (una Stack propia),
// no una pantalla: al cambiar de pestaña la pila anterior queda montada con su historial intacto.
// Tocar la pestaña ya activa hace popToTop de su pila (comportamiento por defecto de React Navigation).
export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: { borderTopColor: colors.border, backgroundColor: colors.background },
        }}>
        <Tabs.Screen name="(home)" options={{ tabBarIcon: icon('home', 'home-outline') }} />
        <Tabs.Screen name="(explore)" options={{ tabBarIcon: icon('search', 'search-outline') }} />
        <Tabs.Screen name="create" options={{ tabBarIcon: icon('add-circle', 'add-circle-outline') }} />
        <Tabs.Screen name="(activity)" options={{ tabBarIcon: icon('heart', 'heart-outline') }} />
        <Tabs.Screen name="(profile)" options={{ tabBarIcon: icon('person-circle', 'person-circle-outline') }} />
      </Tabs>
      {/* Encima de todas las pestañas: el estado de la cola es global, no de una pantalla. */}
      <SyncBanner />
    </View>
  );
}
