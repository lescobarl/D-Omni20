/**
 * Utilidades de identidad UUIDv4.
 *
 * Contrato:
 * - `uuidv4()` genera un identificador UUIDv4 compatible con RFC 4122.
 * - Usa `crypto.randomUUID` cuando está disponible y un fallback determinista en su ausencia.
 */

/** Genera un identificador UUIDv4 (RFC 4122). */
export function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
