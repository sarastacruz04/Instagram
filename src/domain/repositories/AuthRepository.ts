// Contrato (puerto) que la capa de datos debe cumplir.
// La presentación depende de ESTA interfaz, nunca de la implementación con Supabase
// (Principio de Inversión de Dependencias).
export interface SignUpInput {
  email: string;
  password: string;
  username: string;
  fullName: string;
}

export type Unsubscribe = () => void;

export interface AuthRepository {
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<void>;
  signOut(): Promise<void>;
  /** Notifica el userId actual (o null) cada vez que cambia la sesión, incluida la sesión inicial. */
  onAuthStateChange(listener: (userId: string | null) => void): Unsubscribe;
}
