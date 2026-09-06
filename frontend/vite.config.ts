import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Configuración de Vite y Vitest para OmniBotIA Studio Frontend.
 *
 * Contrato:
 * - Resuelve el alias `@/*` hacia `src/*`.
 * - Configura el servidor de desarrollo en el puerto 5173.
 * - Configura Vitest con cobertura > 80% y dos proyectos por entorno:
 *   - `jsdom`: tests de componentes React, stores y lógica con dependencia de DOM.
 *   - `node`: tests de lógica pura (core, lib, services, api, monaco, etc.) que
 *     no necesitan DOM. Corren más rápido y sin cargar jest-dom/axe.
 *
 * Regla #14 (aceleración): separar el setup por entorno. Cada proyecto declara su
 * propio `setupFiles` y su propio `include`/`exclude` para que los archivos sean
 * disjuntos (ningún test se ejecuta dos veces).
 *
 * NOTA: el `include` NO se define a nivel raíz. Con `test.projects`, cada proyecto
 * hereda la config raíz vía `extends: true` y Vite concatena los arrays de `include`
 * (mergeConfig). Si la raíz declarara un `include` amplio, se fusionaría con el de
 * cada proyecto y el proyecto `node` acabaría ejecutando también los tests de React.
 */

// Archivos de lógica pura migrados al entorno `node` (sin DOM, sin React).
// Si un test nuevo es de lógica pura, añádelo aquí y exclúyelo del proyecto jsdom.
const NODE_TEST_FILES = [
  'src/core/utm.test.ts',
  'src/core/aiConfig.test.ts',
  'src/core/blocks.test.ts',
  'src/core/landingCode.test.ts',
  'src/core/workflows.test.ts',
  'src/lib/config.test.ts',
  'src/lib/logger.test.ts',
  'src/lib/rbac.test.ts',
  'src/monaco/jinja2.test.ts',
  'src/api/client.test.ts',
  'src/test/protocolGuard.test.ts',
  'src/components/Crm/crmFormat.test.ts',
  'src/components/Editor/dnd/dragData.test.ts',
  'src/components/Editor/VisualSchema/schemaTree.test.ts',
  'src/services/*.test.ts',
];

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
    css: true,
    // Timeout ampliado: bajo carga (workers/cobertura) algunos tests de UI de
    // jsdom rozan los 5s por defecto y producían falsos negativos intermitentes.
    testTimeout: 10000,
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
    // Dos proyectos disjuntos: jsdom (DOM/React) y node (lógica pura).
    projects: [
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          // Todos los tests salvo los de lógica pura migrados a `node`.
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: [...NODE_TEST_FILES],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: ['./src/test/setup.node.ts'],
          include: [...NODE_TEST_FILES],
        },
      },
    ],
  },
});
