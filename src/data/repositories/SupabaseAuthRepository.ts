import type { AuthRepository, SignUpInput, Unsubscribe } from '@/domain/repositories/AuthRepository';
import { AppError } from '@/domain/errors';

import { supabase } from '../remote/supabaseClient';

function toAppError(error: { message: string; status?: number }): AppError {
  const msg = error.message.toLowerCase();
  if (msg.includes('invalid login credentials')) return new AppError('Correo o contraseña incorrectos', 'auth');
  if (msg.includes('email not confirmed')) {
    return new AppError('Esta cuenta no ha confirmado su correo. Desactiva "Confirm email" en Supabase o confírmala desde el panel.', 'auth');
  }
  if (msg.includes('signups') && msg.includes('disabled')) {
    return new AppError('El registro está desactivado en Supabase (Allow new users to sign up).', 'auth');
  }
  if (msg.includes('database error saving new user')) {
    // El trigger handle_new_user falló: casi siempre el username viola UNIQUE o el CHECK.
    return new AppError('Ese nombre de usuario no es válido o ya existe.', 'validation');
  }
  if (msg.includes('already registered')) return new AppError('Ese correo ya está registrado', 'auth');
  if (msg.includes('password')) return new AppError('La contraseña debe tener al menos 6 caracteres', 'validation');
  if (msg.includes('network') || msg.includes('fetch')) return new AppError('Sin conexión a internet', 'network');
  return new AppError(error.message, 'unknown');
}

export class SupabaseAuthRepository implements AuthRepository {
  async signIn(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw toAppError(error);
  }

  async signUp({ email, password, username, fullName }: SignUpInput): Promise<void> {
    // username y full_name viajan como metadata; el trigger handle_new_user crea el perfil.
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { username: username.toLowerCase(), full_name: fullName } },
    });
    if (error) throw toAppError(error);
    // Con "Confirm email" activo, Supabase crea el usuario pero NO devuelve sesión:
    // sin este aviso el registro parecía "no hacer nada".
    if (!data.session) {
      throw new AppError(
        'La cuenta se creó pero requiere confirmar el correo. Desactiva "Confirm email" en Supabase (Authentication → Sign In / Providers → Email) y confírmala en Authentication → Users.',
        'auth',
      );
    }
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  }

  onAuthStateChange(listener: (userId: string | null) => void): Unsubscribe {
    // Se dispara de inmediato con INITIAL_SESSION (sesión restaurada del disco) y luego en cada cambio.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // No se debe llamar a supabase dentro de este callback: supabase-js mantiene un lock
      // interno mientras lo ejecuta y una llamada anidada puede quedar bloqueada (deadlock).
      // setTimeout(0) difiere el trabajo al siguiente turno del event loop, ya sin el lock.
      setTimeout(() => listener(session?.user.id ?? null), 0);
    });
    return () => data.subscription.unsubscribe();
  }
}
