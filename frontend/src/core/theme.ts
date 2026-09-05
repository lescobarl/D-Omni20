/**
 * Motor de tema del tenant (rebranding automático) — Fase 2.
 *
 * Contrato:
 * - `applyTheme(theme)` materializa la apariencia del tenant como variables CSS
 *   `--omni-*` sobre la raíz del documento, que consumen los tokens de Tailwind.
 * - Ante `null` (tenant sin apariencia o error 404) se aplica `DEFAULT_THEME`,
 *   la paleta histórica del configurador (fallback determinista).
 * - `generateShades` deriva la escala 50–950 a partir del color base manteniendo
 *   el 500 idéntico al color de la marca (fidelidad del rebranding).
 * - Los colores se guardan como tripletas RGB (`r g b`) porque así los consume
 *   `tailwind.config.js` con `/ <alpha-value>` (opacidad de Tailwind).
 */
import { DEFAULT_THEME } from '@/lib/config';
import type { IAppTheme } from '@/types/config';

/** Valor RGB con componentes en [0, 255]. */
export interface IRgb {
  /** Componente roja (0-255). */
  r: number;
  /** Componente verde (0-255). */
  g: number;
  /** Componente azul (0-255). */
  b: number;
}

/** Valor HSL con matiz en [0, 360) y saturación/luminosidad en [0, 1]. */
export interface IHsl {
  /** Matiz en grados [0, 360). */
  h: number;
  /** Saturación [0, 1]. */
  s: number;
  /** Luminosidad [0, 1]. */
  l: number;
}

/** Límite superior de luminosidad para la escala de claros. */
const LIGHT_TARGET = 0.97;
/** Límite inferior de luminosidad para la escala de oscuros. */
const DARK_TARGET = 0.08;

/** Definición de cada tono de la escala (t: interpolación 0 = color base). */
const SHADE_STOPS: readonly { shade: number; t: number }[] = [
  { shade: 50, t: 0.9 },
  { shade: 100, t: 0.7 },
  { shade: 200, t: 0.5 },
  { shade: 300, t: 0.3 },
  { shade: 400, t: 0.12 },
  { shade: 500, t: 0 },
  { shade: 600, t: 0.15 },
  { shade: 700, t: 0.35 },
  { shade: 800, t: 0.55 },
  { shade: 900, t: 0.75 },
  { shade: 950, t: 0.9 },
];

/** Tonos de la escala en orden ascendente (expuesto para tests y UI). */
export const SHADE_KEYS: readonly number[] = SHADE_STOPS.map((stop) => stop.shade);

/** Factor de saturación por tono (los claros se desaturan ligeramente). */
const SATURATION_FACTORS: Readonly<Record<number, number>> = {
  50: 0.7,
  100: 0.85,
  200: 0.95,
};

/** Acota un valor numérico al rango cerrado [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Convierte un color hexadecimal (`#rgb` o `#rrggbb`) a componentes RGB.
 * @param hex - Color en formato hexadecimal (con o sin `#`).
 * @returns Componentes RGB enteras en [0, 255].
 * @throws Si el color no es un hexadecimal válido de 3 o 6 dígitos.
 */
export function hexToRgb(hex: string): IRgb {
  const normalized = hex.trim().replace(/^#/, '');
  let value = normalized;
  if (normalized.length === 3) {
    value = normalized
      .split('')
      .map((char) => char + char)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`Color hexadecimal inválido: "${hex}".`);
  }
  const int = parseInt(value, 16);
  return {
    r: (int >> 16) & 0xff,
    g: (int >> 8) & 0xff,
    b: int & 0xff,
  };
}

/**
 * Convierte componentes RGB a un color hexadecimal (`#rrggbb`).
 * @param rgb - Componentes RGB con valores en [0, 255].
 * @returns Color hexadecimal normalizado.
 */
export function rgbToHex({ r, g, b }: IRgb): string {
  const toChannel = (value: number): string =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${toChannel(r)}${toChannel(g)}${toChannel(b)}`;
}

/**
 * Convierte componentes RGB a HSL (matiz en grados, saturación/luminosidad en [0, 1]).
 * @param rgb - Componentes RGB con valores en [0, 255].
 * @returns Componentes HSL normalizadas.
 */
export function rgbToHsl({ r, g, b }: IRgb): IHsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === rn) {
      h = 60 * (((gn - bn) / delta) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / delta + 2);
    } else {
      h = 60 * ((rn - gn) / delta + 4);
    }
  }
  return { h: (h + 360) % 360, s, l };
}

/**
 * Convierte componentes HSL a RGB (resultado en [0, 255], puede incluir fracciones).
 * @param hsl - Componentes HSL (matiz en grados, saturación/luminosidad en [0, 1]).
 * @returns Componentes RGB con valores en [0, 255].
 */
export function hslToRgb({ h, s, l }: IHsl): IRgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/**
 * Genera la escala 50–950 a partir de un color base (el 500 es el color exacto).
 * @param base - Color hexadecimal del tono medio de la escala.
 * @returns Mapa de tono → color hexadecimal de la escala derivada.
 */
export function generateShades(base: string): Readonly<Record<number, string>> {
  const { h, s, l } = rgbToHsl(hexToRgb(base));
  const shades: Record<number, string> = {};
  for (const { shade, t } of SHADE_STOPS) {
    const lightness =
      t === 0 ? l : l + ((t > 0 && shade < 500 ? LIGHT_TARGET : DARK_TARGET) - l) * t;
    const saturation = s * (SATURATION_FACTORS[shade] ?? 1);
    shades[shade] = rgbToHex(hslToRgb({ h, s: saturation, l: clamp(lightness, 0, 1) }));
  }
  return shades;
}

/**
 * Convierte un color hexadecimal a la tripleta `r g b` que consumen los tokens.
 * @param hex - Color hexadecimal.
 * @returns Tripleta RGB separada por espacios.
 */
export function toRgbTriplet(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `${r} ${g} ${b}`;
}

/** Desplaza la luminosidad de un color (delta en [0, 1], positivo = más claro). */
function shiftLightness(hex: string, delta: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, l: clamp(hsl.l + delta, 0, 1) }));
}

/**
 * Aplica la apariencia del tenant como variables CSS sobre la raíz del documento.
 * @param theme - Apariencia del tenant; `null` aplica `DEFAULT_THEME` (fallback).
 * @param root - Elemento raíz donde se materializan las variables (tests: nodo jsdom).
 */
export function applyTheme(
  theme: IAppTheme | null,
  root: HTMLElement = document.documentElement,
): void {
  const resolved = theme ?? DEFAULT_THEME;
  const brand = generateShades(resolved.primaryColor);
  const accent = generateShades(resolved.accentColor);

  for (const shade of SHADE_KEYS) {
    root.style.setProperty(`--omni-brand-${shade}`, toRgbTriplet(brand[shade]));
    root.style.setProperty(`--omni-accent-${shade}`, toRgbTriplet(accent[shade]));
  }

  root.style.setProperty('--omni-surface', toRgbTriplet(resolved.surfaceColor));
  root.style.setProperty(
    '--omni-surface-muted',
    toRgbTriplet(shiftLightness(resolved.surfaceColor, -0.02)),
  );
  root.style.setProperty(
    '--omni-surface-strong',
    toRgbTriplet(shiftLightness(resolved.surfaceColor, -0.08)),
  );
  root.style.setProperty('--omni-text', toRgbTriplet(resolved.textColor));
  root.style.setProperty(
    '--omni-text-muted',
    toRgbTriplet(shiftLightness(resolved.textColor, 0.35)),
  );
  root.style.setProperty('--omni-brand-badge', toRgbTriplet(resolved.brandBadge));

  if (resolved.fontFamily !== undefined && resolved.fontFamily !== '') {
    root.style.setProperty('--omni-font-family', resolved.fontFamily);
  } else {
    root.style.removeProperty('--omni-font-family');
  }
}
