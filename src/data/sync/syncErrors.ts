// Error de una llamada remota con la información necesaria para decidir si reintentar.
export class RemoteError extends Error {
  constructor(
    message: string,
    /** SQLSTATE de Postgres (p. ej. '23505') o código de PostgREST ('PGRST…'). Vacío si fue la red. */
    readonly code: string,
    /** HTTP status. supabase-js devuelve 0 cuando la petición ni siquiera llegó (sin red). */
    readonly status: number,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

/** Convierte la respuesta `{ error, status }` de supabase-js en una excepción tipada. */
export function ensureOk(res: { error: { message: string; code?: string } | null; status: number }): void {
  if (res.error) throw new RemoteError(res.error.message, res.error.code ?? '', res.status);
}

/**
 * Storage (supabase-js) usa otras clases de error: StorageApiError trae `status` HTTP;
 * StorageUnknownError (fallo de red) no trae status → se trata como 0 (sin red).
 */
export function ensureStorageOk(error: { message: string; status?: number; statusCode?: string } | null): void {
  if (error) throw new RemoteError(error.message, error.statusCode ?? '', error.status ?? 0);
}

export type ErrorKind =
  | 'transient'  // reintentar más tarde (sin red, servidor caído, token vencido)
  | 'permanent'  // el servidor la rechazó: reintentar nunca va a funcionar
  | 'duplicate'; // ya estaba aplicada → se considera ÉXITO (idempotencia)

export function classifyError(error: unknown): ErrorKind {
  if (!(error instanceof RemoteError)) return 'transient'; // fallo inesperado de red/JS: prudencia
  const { code, status } = error;

  if (code === '23505') return 'duplicate';           // unique_violation: el registro ya existe
  if (status === 0) return 'transient';               // sin conexión
  if (status === 401) return 'transient';             // JWT vencido: supabase-js lo refresca y se reintenta
  if (status === 408 || status === 429) return 'transient'; // timeout / rate limit
  if (status >= 500) return 'transient';              // error del servidor

  // 4xx con código Postgres: 23503 FK (el post fue borrado), 23514 CHECK, 42501 RLS (perdí el
  // permiso, p. ej. la cuenta se volvió privada), 22xxx dato inválido. Reintentar no lo arregla.
  return 'permanent';
}
