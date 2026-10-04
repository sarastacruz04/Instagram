import { rememberDeepLink } from '@/presentation/navigation/pendingDeepLink';
import { useSession } from '@/presentation/stores/sessionStore';

// Intercepta TODOS los links que abren la app (antes de que el router resuelva la ruta).
//   Development build:  instagramclone://post/<uuid>
//   Expo Go:            exp://<ip>:8081/--/post/<uuid>   (Expo Go no puede registrar nuestro scheme)
//
// ¿Por qué hace falta? `post/[id]` existe en las 4 pilas (shared routes). En un link en frío
// expo-router elegiría la primera pila por orden alfabético: (activity). Aquí la forzamos a Home.
const POST_LINK = /post\/([0-9a-f-]{36})/i;
const USER_LINK = /user\/([0-9a-f-]{36})/i;

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const post = path.match(POST_LINK);
    const user = path.match(USER_LINK);
    const target = post ? `/(tabs)/(home)/post/${post[1]}` : user ? `/(tabs)/(home)/user/${user[1]}` : null;
    if (!target) return path;
    // Si no hay sesión (o aún se está restaurando), el login "se come" el destino: se recuerda
    // para abrirlo tras entrar. Con sesión activa, el router lo abre directamente.
    if (useSession.getState().status !== 'signedIn') rememberDeepLink(target);
    return target;
  } catch {
    // Nunca dejar que un link malformado tumbe la app: se abre el inicio.
    return '/';
  }
}
