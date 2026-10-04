import { Stack } from 'expo-router';

// Al cerrar sesión, Stack.Protected redirige a este grupo: que arranque en login.
export const unstable_settings = { initialRouteName: 'login' };

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
