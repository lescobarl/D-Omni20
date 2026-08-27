/**
 * Utilidades de descarga del HTML compilado de una landing.
 *
 * Contrato:
 * - `buildDownloadFileName` convierte el título de la landing en un nombre de
 *   archivo seguro (slug): normaliza acentos, pasa a minúsculas, colapsa los
 *   separadores en guiones y elimina caracteres no alfanuméricos. Si el slug
 *   resultante es vacío usa `DOWNLOAD_FILE_PREFIX` como base. El nombre siempre
 *   termina en `.<DOWNLOAD_FILE_EXTENSION>`.
 * - `downloadHtml` dispara la descarga de un documento HTML en el navegador
 *   mediante un Blob y una URL de objeto efímera (creada, enlazada y revocada).
 */

/** Prefijo de nombre de archivo cuando el título no produce un slug válido. */
export const DOWNLOAD_FILE_PREFIX = 'landing';

/** Extensión de archivo usada en las descargas de HTML. */
export const DOWNLOAD_FILE_EXTENSION = 'html';

/**
 * Convierte el título de una landing en un nombre de archivo seguro.
 * @param title - Título de la landing a convertir.
 * @returns Nombre de archivo con extensión `.html`.
 */
export function buildDownloadFileName(title: string): string {
  const slug =
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || DOWNLOAD_FILE_PREFIX;
  return `${slug}.${DOWNLOAD_FILE_EXTENSION}`;
}

/**
 * Descarga un documento HTML en el navegador como archivo.
 * @param html - Contenido HTML que se descargará.
 * @param fileName - Nombre del archivo de destino.
 */
export function downloadHtml(html: string, fileName: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
