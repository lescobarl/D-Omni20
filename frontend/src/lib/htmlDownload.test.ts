/**
 * Pruebas de las utilidades de descarga de HTML compilado.
 *
 * Contrato verificado:
 * - `buildDownloadFileName` produce slugs seguros: normaliza acentos, pasa a
 *   minúsculas, colapsa separadores en guiones y cae al prefijo cuando el
 *   título no deja caracteres alfanuméricos.
 * - `downloadHtml` crea un Blob `text/html`, lo enlaza en un ancla efímera con
 *   atributo `download`, lo añade al documento, dispara el clic y revoca la
 *   URL de objeto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDownloadFileName,
  downloadHtml,
  DOWNLOAD_FILE_EXTENSION,
  DOWNLOAD_FILE_PREFIX,
} from '@/lib/htmlDownload';

describe('buildDownloadFileName', () => {
  it('convierte un título común en un slug con guiones', () => {
    expect(buildDownloadFileName('Oferta de lanzamiento')).toBe('oferta-de-lanzamiento.html');
  });

  it('normaliza acentos y minúsculas', () => {
    expect(buildDownloadFileName('Lánzamiento Árbol Único')).toBe('lanzamiento-arbol-unico.html');
  });

  it('colapsa separadores múltiples y recorta guiones externos', () => {
    expect(buildDownloadFileName('  Múltiples   espacios  ')).toBe('multiples-espacios.html');
  });

  it('conserva dígitos y elimina símbolos', () => {
    expect(buildDownloadFileName('Producto ★ 100%')).toBe('producto-100.html');
  });

  it('cae al prefijo cuando el título está vacío', () => {
    expect(buildDownloadFileName('')).toBe(`${DOWNLOAD_FILE_PREFIX}.${DOWNLOAD_FILE_EXTENSION}`);
  });

  it('cae al prefijo cuando el título solo tiene símbolos', () => {
    expect(buildDownloadFileName('¡¡¡!!!')).toBe(
      `${DOWNLOAD_FILE_PREFIX}.${DOWNLOAD_FILE_EXTENSION}`,
    );
  });
});

describe('downloadHtml', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    // jsdom no implementa la navegación por clic de anclas; se simula el clic
    // para que la descarga no dispare "navigation (except hash changes)".
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('crea un Blob de tipo text/html con el contenido descargado', () => {
    const html = '<!doctype html><title>Demo</title>';
    downloadHtml(html, 'landing.html');
    const [blob] = vi.mocked(URL.createObjectURL).mock.calls[0] as [Blob];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/html');
    expect(blob.size).toBe(html.length);
  });

  it('enlaza el ancla con la URL de objeto y el nombre de descarga y dispara el clic', () => {
    downloadHtml('<html></html>', 'landing.html');

    const clicked = vi.mocked(HTMLAnchorElement.prototype.click).mock.instances[0] as
      HTMLAnchorElement | undefined;
    expect(clicked).toBeDefined();
    expect(clicked?.href).toBe('blob:mock-url');
    expect(clicked?.download).toBe('landing.html');
  });

  it('añade el ancla al documento, la retira y revoca la URL de objeto', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    downloadHtml('<html></html>', 'landing.html');

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});
