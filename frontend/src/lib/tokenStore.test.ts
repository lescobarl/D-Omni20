/**
 * Pruebas del almacén de sesión (`tokenStore`) — token JWT en `localStorage`.
 *
 * Contrato:
 * - `getAccessToken`/`setAccessToken` persisten bajo una clave fija.
 * - `clearAccessToken` limpia la sesión (equivale a `setAccessToken(null)`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAccessToken, getAccessToken, setAccessToken } from '@/lib/tokenStore';

const TOKEN_KEY = 'omnibotia-studio.access-token';

describe('tokenStore', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });

  afterEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });

  it('parte sin sesión (token nulo)', () => {
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('setAccessToken persiste el token en localStorage', () => {
    setAccessToken('jwt-ejemplo');

    expect(localStorage.getItem(TOKEN_KEY)).toBe('jwt-ejemplo');
    expect(getAccessToken()).toBe('jwt-ejemplo');
  });

  it('clearAccessToken elimina el token persistido', () => {
    setAccessToken('jwt-ejemplo');
    clearAccessToken();

    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
