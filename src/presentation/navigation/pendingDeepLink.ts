// Deep link pendiente: si el link llega SIN sesión, Stack.Protected manda al login y el
// destino se perdería. Se recuerda aquí y se abre en cuanto el usuario inicia sesión.
// Es una variable de módulo (no estado de React): no se dibuja, solo se consume una vez.
let pending: string | null = null;

export function rememberDeepLink(path: string): void {
  pending = path;
}

/** Devuelve el destino pendiente y lo borra (se consume una sola vez). */
export function consumeDeepLink(): string | null {
  const path = pending;
  pending = null;
  return path;
}
