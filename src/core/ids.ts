import { randomUUID } from 'expo-crypto';

/**
 * UUID v4 generado en el cliente (generador aleatorio criptográfico nativo).
 * Permite crear posts/comentarios/mensajes SIN red: el id existe desde el primer
 * instante, la UI lo puede mostrar y el reintento offline es idempotente.
 */
export function newId(): string {
  return randomUUID();
}
