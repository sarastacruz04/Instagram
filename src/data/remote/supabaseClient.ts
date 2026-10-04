// localStorage respaldado por SQLite: supabase-js guarda aquí el token de sesión,
// así la sesión sobrevive a cerrar la app. El acceso a SQLite ocurre en un hilo nativo.
import 'expo-sqlite/localStorage/install';

import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

// EXPO_PUBLIC_* se incrustan en el bundle al compilar. La publishable key es pública
// por diseño: la seguridad la garantizan las políticas RLS, no esconder la llave.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error('Faltan EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY en .env.local');
}

export const supabase = createClient(url, key, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** Id del usuario de la sesión actual (leída del almacenamiento local, sin red). */
export async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Sin sesión');
  return id;
}

// El refresco del token usa un timer en el hilo JS. En segundo plano el SO puede
// congelar ese hilo, así que lo pausamos y lo reanudamos al volver a primer plano.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
