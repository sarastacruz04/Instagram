import { DefaultTheme, type Href, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { consumeDeepLink } from '@/presentation/navigation/pendingDeepLink';
import { startDirectMessages } from '@/presentation/stores/dmStore';
import { bootstrapSession, useSession } from '@/presentation/stores/sessionStore';
import { colors } from '@/presentation/theme';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.background, primary: colors.text },
};

export default function RootLayout() {
  // Selector: este layout solo se re-renderiza si cambia `status`, no el perfil.
  const status = useSession((s) => s.status);

  useEffect(() => {
    bootstrapSession();
  }, []);

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync();
  }, [status]);

  // Mensajería en tiempo real mientras haya sesión. El cleanup cierra el canal al salir.
  const userId = useSession((s) => s.userId);
  useEffect(() => {
    if (!userId) return;
    return startDirectMessages(userId);
  }, [userId]);

  // Deep link que llegó sin sesión: abrirlo cuando el usuario pasa de signedOut → signedIn.
  // Si la app arrancó YA con sesión (loading → signedIn), el router abrió el link solo:
  // se descarta para no navegar dos veces.
  const previousStatus = useRef(status);
  useEffect(() => {
    const before = previousStatus.current;
    previousStatus.current = status;
    if (status !== 'signedIn') return;
    const link = consumeDeepLink();
    if (link && before === 'signedOut') {
      // setTimeout: esperar a que Stack.Protected monte las rutas protegidas antes de navegar.
      setTimeout(() => router.push(link as Href), 0);
    }
  }, [status]);

  // Mientras se restaura la sesión del disco no montamos rutas: evita un "parpadeo" del login.
  if (status === 'loading') return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <StatusBar style="dark" />
        {/* Pila RAÍZ. Las tabs son UNA pantalla de esta pila; DMs e historias se apilan
            ENCIMA de las tabs (ocultan la barra inferior, como en Instagram). */}
        <Stack screenOptions={{ headerShown: false }}>
          {/* Stack.Protected: si el guard es false, esas rutas no existen y se redirige. */}
          <Stack.Protected guard={status === 'signedIn'}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="inbox" options={{ headerShown: true, title: 'Mensajes' }} />
            <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: '' }} />
            <Stack.Screen name="share/[postId]" options={{ headerShown: true, presentation: 'modal' }} />
            <Stack.Screen
              name="stories/[userId]"
              options={{ presentation: 'fullScreenModal', animation: 'fade' }}
            />
          </Stack.Protected>
          <Stack.Protected guard={status === 'signedOut'}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
