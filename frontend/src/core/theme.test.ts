/**
 * Tests del motor de temas: conversión de color, generación de escalas 50–950
 * y aplicación de la apariencia del tenant como variables CSS.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  generateShades,
  hexToRgb,
  hslToRgb,
  rgbToHex,
  rgbToHsl,
  SHADE_KEYS,
  toRgbTriplet,
} from '@/core/theme';
import { DEFAULT_THEME } from '@/lib/config';
import type { IAppTheme } from '@/types/config';

/** Nodo DOM simulado que registra las mutaciones de las variables CSS. */
function makeRoot(): {
  root: HTMLElement;
  setProperty: ReturnType<typeof vi.fn>;
  removeProperty: ReturnType<typeof vi.fn>;
} {
  const setProperty = vi.fn();
  const removeProperty = vi.fn();
  const root = { style: { setProperty, removeProperty } } as unknown as HTMLElement;
  return { root, setProperty, removeProperty };
}

/** Tema de dominio de prueba (colores primarios RGB). */
function makeTheme(overrides: Partial<IAppTheme> = {}): IAppTheme {
  return {
    primaryColor: '#ff0000',
    accentColor: '#00ff00',
    surfaceColor: '#000000',
    textColor: '#ffffff',
    brandBadge: '#0000ff',
    ...overrides,
  };
}

describe('hexToRgb', () => {
  it('convierte un color hex corto expandiendo cada canal', () => {
    expect(hexToRgb('#f09')).toEqual({ r: 255, g: 0, b: 153 });
  });

  it('convierte un color hex largo sin prefijo y recortando espacios', () => {
    expect(hexToRgb('  10b981  ')).toEqual({ r: 16, g: 185, b: 129 });
  });

  it('acepta mayúsculas y minúsculas por igual', () => {
    expect(hexToRgb('#10B981')).toEqual({ r: 16, g: 185, b: 129 });
  });

  it('lanza un error claro para colores inválidos', () => {
    expect(() => hexToRgb('#12345')).toThrow('Color hexadecimal inválido: "#12345".');
    expect(() => hexToRgb('#gggggg')).toThrow('Color hexadecimal inválido: "#gggggg".');
  });
});

describe('rgbToHex', () => {
  it('clampa los canales fuera del rango 0-255', () => {
    expect(rgbToHex({ r: 300, g: -5, b: 128 })).toBe('#ff0080');
  });

  it('redondea los canales fraccionarios', () => {
    expect(rgbToHex({ r: 10.4, g: 10.6, b: 10.5 })).toBe('#0a0b0b');
  });
});

describe('rgbToHsl', () => {
  it('convierte el rojo puro a h=0, s=1, l=0.5', () => {
    const { h, s, l } = rgbToHsl({ r: 255, g: 0, b: 0 });
    expect(h).toBeCloseTo(0);
    expect(s).toBeCloseTo(1);
    expect(l).toBeCloseTo(0.5);
  });
});

describe('hslToRgb', () => {
  it('mantiene el color al convertir RGB → HSL → RGB', () => {
    const original = { r: 16, g: 185, b: 129 };
    const roundtrip = hslToRgb(rgbToHsl(original));
    expect(roundtrip.r).toBeCloseTo(original.r, 0);
    expect(roundtrip.g).toBeCloseTo(original.g, 0);
    expect(roundtrip.b).toBeCloseTo(original.b, 0);
  });
});

describe('generateShades', () => {
  it('expone la escala completa de 11 tonos', () => {
    expect(SHADE_KEYS).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);
  });

  it('mantiene el tono 500 idéntico al color base', () => {
    const shades = generateShades('#10b981');
    expect(shades[500]).toBe('#10b981');
  });

  it('devuelve todos los tonos como hex válidos de 6 dígitos', () => {
    const shades = generateShades('#10b981');
    for (const shade of SHADE_KEYS) {
      expect(shades[shade]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('genera una escala de luminosidad monótona decreciente', () => {
    const shades = generateShades('#ff0000');
    const lightness = SHADE_KEYS.map((shade) => rgbToHsl(hexToRgb(shades[shade])).l);
    for (let i = 1; i < lightness.length; i += 1) {
      expect(lightness[i]).toBeLessThan(lightness[i - 1]);
    }
  });

  it('aplica los factores de saturación a los tonos claros', () => {
    const shades = generateShades('#ff0000');
    const saturation = (shade: number): number => rgbToHsl(hexToRgb(shades[shade])).s;
    expect(saturation(50)).toBeLessThan(saturation(100));
    expect(saturation(100)).toBeLessThan(saturation(200));
    expect(saturation(200)).toBeLessThan(saturation(500));
  });
});

describe('toRgbTriplet', () => {
  it('serializa un hex a la tripleta RGB separada por espacios', () => {
    expect(toRgbTriplet('#10b981')).toBe('16 185 129');
  });
});

describe('applyTheme', () => {
  it('aplica el tema por defecto cuando no se provee ninguno', () => {
    const { root, setProperty, removeProperty } = makeRoot();
    applyTheme(null, root);
    expect(setProperty).toHaveBeenCalledWith('--omni-brand-500', '16 185 129');
    expect(setProperty).toHaveBeenCalledWith('--omni-accent-500', '59 130 246');
    expect(setProperty).toHaveBeenCalledWith('--omni-surface', '255 255 255');
    expect(setProperty).toHaveBeenCalledWith('--omni-text', '15 23 42');
    expect(setProperty).toHaveBeenCalledWith('--omni-brand-badge', '16 185 129');
    expect(removeProperty).toHaveBeenCalledWith('--omni-font-family');
  });

  it('aplica todos los tonos de las escalas de marca y acento', () => {
    const { root, setProperty } = makeRoot();
    applyTheme(DEFAULT_THEME, root);
    for (const shade of SHADE_KEYS) {
      expect(setProperty).toHaveBeenCalledWith(`--omni-brand-${shade}`, expect.any(String));
      expect(setProperty).toHaveBeenCalledWith(`--omni-accent-${shade}`, expect.any(String));
    }
  });

  it('deriva las superficies del color de fondo', () => {
    const { root, setProperty } = makeRoot();
    applyTheme(DEFAULT_THEME, root);
    expect(setProperty).toHaveBeenCalledWith('--omni-surface-muted', '250 250 250');
    expect(setProperty).toHaveBeenCalledWith('--omni-surface-strong', '235 235 235');
    expect(setProperty).toHaveBeenCalledWith('--omni-text-muted', expect.any(String));
  });

  it('aplica un tema personalizado con todos los colores', () => {
    const { root, setProperty } = makeRoot();
    applyTheme(makeTheme(), root);
    expect(setProperty).toHaveBeenCalledWith('--omni-brand-500', '255 0 0');
    expect(setProperty).toHaveBeenCalledWith('--omni-accent-500', '0 255 0');
    expect(setProperty).toHaveBeenCalledWith('--omni-surface', '0 0 0');
    expect(setProperty).toHaveBeenCalledWith('--omni-text', '255 255 255');
    expect(setProperty).toHaveBeenCalledWith('--omni-brand-badge', '0 0 255');
  });

  it('establece la tipografía cuando se provee', () => {
    const { root, setProperty, removeProperty } = makeRoot();
    applyTheme(makeTheme({ fontFamily: 'Georgia' }), root);
    expect(setProperty).toHaveBeenCalledWith('--omni-font-family', 'Georgia');
    expect(removeProperty).not.toHaveBeenCalledWith('--omni-font-family');
  });

  it('elimina la tipografía cuando es vacía o ausente', () => {
    const empty = makeRoot();
    applyTheme(makeTheme({ fontFamily: '' }), empty.root);
    expect(empty.removeProperty).toHaveBeenCalledWith('--omni-font-family');

    const missing = makeRoot();
    applyTheme(makeTheme({ fontFamily: undefined }), missing.root);
    expect(missing.removeProperty).toHaveBeenCalledWith('--omni-font-family');
  });
});
