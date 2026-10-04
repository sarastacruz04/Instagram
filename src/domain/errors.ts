// Error de dominio con un mensaje apto para mostrar al usuario.
// La capa de datos traduce los errores de Supabase/red a este tipo,
// así la UI nunca depende de códigos de error del proveedor.
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: 'network' | 'auth' | 'validation' | 'forbidden' | 'unknown' = 'unknown',
  ) {
    super(message);
    this.name = 'AppError';
  }
}
