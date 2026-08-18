import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Configuración de Vite y Vitest para OmniBotIA Studio Frontend.
 *
 * Contrato:
 * - Resuelve el alias `@/*` hacia `src/*`.
 * - Configura el servidor de desarrollo en el puerto 5173.
 * - Configura Vitest con entorno jsdom, globals habilitados y cobertura > 80%.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Los tests E2E (Playwright) viven en `e2e/` y no deben ejecutarse aquí.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // `all: false` evita el doble conteo de archivos en Windows: el pase
      // "all files" registra rutas con el drive en mayúscula (`D:`), mientras
      // el runner de módulos emite las rutas en minúscula (`d:`). Esto genera
      // entradas duplicadas (una con datos reales y otra "(empty-report)" con
      // ceros) que reducen la cobertura global a la mitad. Desactivar el pase
      // "all" elimina esas entradas sintéticas por completo.
      all: false,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts', 'src/test/**', 'src/**/*.test.{ts,tsx}'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
