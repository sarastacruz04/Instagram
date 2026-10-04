import { Stack } from 'expo-router';

import { colors } from '@/presentation/theme';

// SHARED ROUTES: la sintaxis (home,explore,activity,profile) le dice a expo-router que
// DUPLIQUE este layout y sus pantallas (post/[id], user/[id], comments/[postId]) en cada grupo.
// Resultado: 4 instancias distintas de Stack, una por pestaña, cada una con su propio historial.
//
// `anchor` define la pantalla raíz de cada pila. Si se entra por deep link directo a
// /post/123, se monta la raíz debajo para que "atrás" funcione en lugar de cerrar la app.
export const unstable_settings = {
  anchor: 'index',
  explore: { anchor: 'explore' },
  activity: { anchor: 'activity' },
  profile: { anchor: 'profile' },
};

export default function TabStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
