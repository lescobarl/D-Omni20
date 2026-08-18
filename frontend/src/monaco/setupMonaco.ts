/**
 * Configuración de Monaco Editor para el navegador.
 *
 * Contrato:
 * - Configura `MonacoEnvironment.getWorker` para cargar el worker del editor desde el bundle
 *   local (sin CDN, mediante el sufijo `?worker` de Vite).
 * - Configura el loader de `@monaco-editor/react` para usar la instancia local de Monaco
 *   (funciona sin conexión a la red).
 * - Importa la API núcleo de Monaco (`editor.api`), no el paquete completo: excluye los ~40
 *   lenguajes básicos y el cliente LSP del árbol de dependencias, lo que reduce el chunk diferido
 *   y su tiempo de parseo (clave para los presupuestos de rendimiento E2E).
 *
 * Nota: este módulo solo lo importa el editor diferido (`MonacoCodeEditor`), por lo que no se
 * ejecuta en los tests de jsdom (anulado por `vi.mock` en `src/test/setup.ts`).
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';

self.MonacoEnvironment = {
  getWorker(): Worker {
    return new editorWorker();
  },
};

loader.config({ monaco });
