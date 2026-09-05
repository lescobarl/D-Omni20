/**
 * Configuración de pruebas para el entorno `node` (lógica pura).
 *
 * Contrato:
 * - NO carga `@testing-library/jest-dom` ni axe-core (dependen de DOM/jsdom).
 * - NO mockea `@monaco-editor/react` (los tests de lógica pura no lo importan).
 * - Mantiene el entorno lo más ligero posible para acelerar la ejecución de
 *   los tests de lógica pura (core, lib, services, api, monaco, etc.).
 *
 * Si un test de lógica pura necesita un matcher o mock global, añádelo aquí
 * (no en `setup.ts`, que es exclusivo del entorno jsdom).
 */
