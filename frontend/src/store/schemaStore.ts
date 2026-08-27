/**
 * Store del editor de JSON Schemas para desarrolladores.
 *
 * Contrato:
 * - Registro de servicios por DI: `setSchemaService`/`getSchemaService` inyectan la
 *   implementación `ISchemaService` desde el composition root (`main.tsx`).
 * - Si no hay servicio registrado, `generate`/`fetchSchemas`/`validate` pasan a
 *   estado de error para que la UI conviva sin la dependencia (p. ej. en pruebas).
 * - `fetchSchemas` no toca el estado del flujo en éxito para no competir con el
 *   estado de `generate` (carga la lista en segundo plano al montar el panel).
 * - El modo visual mantiene un borrador (`draftSchema`) independiente del resultado
 *   de la generación y un estado de validación propio (`validationStatus`).
 */
import { create } from 'zustand';
import type { IDeveloperSchemaRead, ISchemaVersionRead } from '@/api/types';
import { AppError } from '@/lib/errors';
import type {
  ISchemaGenerationResult,
  ISchemaService,
  ISchemaValidationResult,
} from '@/services/schemaService';

/** Estado del flujo de generación de schemas. */
export type SchemaStatus = 'idle' | 'loading' | 'success' | 'error';

/** Contrato del store del editor de schemas. */
export interface ISchemaState {
  /** Estado actual del flujo de generación. */
  status: SchemaStatus;
  /** Prompt introducido por el usuario. */
  prompt: string;
  /** Nombre opcional del schema a generar. */
  name: string;
  /** Última generación exitosa (o `null` si aún no hay). */
  result: ISchemaGenerationResult | null;
  /** Schemas generados del tenant activo (ordenados por actualización). */
  schemas: IDeveloperSchemaRead[];
  /** Identificador del schema seleccionado en la lista (o `null`). */
  selectedSchemaId: string | null;
  /** Versiones del schema seleccionado (descendentes) o `[]` si no hay. */
  versions: ISchemaVersionRead[];
  /** Estado del flujo de versionado del schema seleccionado. */
  versionsStatus: SchemaStatus;
  /** Identificador de la versión seleccionada para inspección (o `null`). */
  selectedVersionId: string | null;
  /** Mensaje del último error de versionado (o `null`). */
  versionsError: string | null;
  /** Mensaje del último error (o `null`). */
  error: string | null;
  /** Indica si el editor visual está abierto. */
  visualMode: boolean;
  /** Borrador del schema en construcción en el editor visual. */
  draftSchema: Record<string, unknown> | null;
  /** Estado del flujo de validación del borrador visual. */
  validationStatus: SchemaStatus;
  /** Último resultado de validación (o `null` si aún no se ha validado). */
  validationResult: ISchemaValidationResult | null;
  /** Mensaje del último error de validación (o `null`). */
  validationError: string | null;
  /** Actualiza el prompt sin disparar la generación. */
  setPrompt(prompt: string): void;
  /** Actualiza el nombre opcional del schema. */
  setName(name: string): void;
  /** Carga la lista de schemas generados del tenant. */
  fetchSchemas(): Promise<void>;
  /** Ejecuta la generación del JSON Schema con el prompt y nombre actuales. */
  generate(): Promise<void>;
  /** Selecciona un schema de la lista para inspeccionarlo (limpia versiones). */
  selectSchema(id: string | null): void;
  /** Carga las versiones del schema seleccionado. */
  fetchVersions(schemaId: string): Promise<void>;
  /** Crea una nueva versión del schema seleccionado con la versión y nota dadas. */
  createVersion(version: string, changeNote?: string): Promise<void>;
  /** Selecciona una versión del historial para inspeccionarla. */
  selectVersion(id: string | null): void;
  /** Abre o cierra el editor visual de schemas. */
  setVisualMode(visualMode: boolean): void;
  /** Actualiza el borrador del schema en construcción en el editor visual. */
  setDraftSchema(draftSchema: Record<string, unknown> | null): void;
  /** Valida el borrador visual (y, opcionalmente, datos de ejemplo) contra el esquema. */
  validate(data?: Record<string, unknown>): Promise<void>;
  /** Descarta el resultado y vuelve al estado inicial. */
  reset(): void;
}

/** Servicio de schemas registrado por el composition root (DI). */
let schemaService: ISchemaService | null = null;

/**
 * Registra la implementación del servicio de schemas.
 * @param service Implementación a inyectar (o `null` para desregistrar).
 */
export function setSchemaService(service: ISchemaService | null): void {
  schemaService = service;
}

/**
 * Devuelve el servicio de schemas registrado.
 * @returns La implementación inyectada o `null` si no se ha registrado.
 */
export function getSchemaService(): ISchemaService | null {
  return schemaService;
}

/** Store del editor de JSON Schemas para desarrolladores. */
export const useSchemaStore = create<ISchemaState>()((set, get) => ({
  status: 'idle',
  prompt: '',
  name: '',
  result: null,
  schemas: [],
  selectedSchemaId: null,
  versions: [],
  versionsStatus: 'idle',
  selectedVersionId: null,
  versionsError: null,
  error: null,
  visualMode: false,
  draftSchema: null,
  validationStatus: 'idle',
  validationResult: null,
  validationError: null,

  setPrompt: (prompt: string) => set({ prompt, error: null }),

  setName: (name: string) => set({ name }),

  fetchSchemas: async () => {
    const service = getSchemaService();
    if (service === null) {
      set({ status: 'error', error: 'El editor de schemas no está disponible.' });
      return;
    }
    try {
      const schemas = await service.list();
      set({ schemas, error: null });
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'No se pudieron cargar los schemas.';
      set({ status: 'error', error: message });
    }
  },

  generate: async () => {
    const { prompt, name } = get();
    if (!prompt.trim()) {
      set({ status: 'error', error: 'Escribe un prompt antes de generar.' });
      return;
    }
    const service = getSchemaService();
    if (service === null) {
      set({ status: 'error', error: 'El editor de schemas no está disponible.' });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      const result = await service.generate(prompt.trim(), name.trim());
      set({ status: 'success', result, selectedSchemaId: null });
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'No se pudo generar el JSON Schema.';
      set({ status: 'error', error: message });
    }
  },

  selectSchema: (id: string | null) =>
    set({
      selectedSchemaId: id,
      versions: [],
      versionsStatus: 'idle',
      selectedVersionId: null,
      versionsError: null,
    }),

  fetchVersions: async (schemaId: string) => {
    const service = getSchemaService();
    if (service === null) {
      set({ versionsStatus: 'error', versionsError: 'El editor de schemas no está disponible.' });
      return;
    }
    set({ versionsStatus: 'loading', versionsError: null });
    try {
      const versions = await service.listVersions(schemaId);
      set({ versions, versionsStatus: 'success', versionsError: null });
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'No se pudieron cargar las versiones del schema.';
      set({ versionsStatus: 'error', versionsError: message });
    }
  },

  createVersion: async (version: string, changeNote?: string) => {
    const { selectedSchemaId } = get();
    if (selectedSchemaId === null) {
      set({ versionsStatus: 'error', versionsError: 'Selecciona un schema para versionarlo.' });
      return;
    }
    const service = getSchemaService();
    if (service === null) {
      set({ versionsStatus: 'error', versionsError: 'El editor de schemas no está disponible.' });
      return;
    }
    set({ versionsStatus: 'loading', versionsError: null });
    try {
      const created = await service.createVersion(selectedSchemaId, {
        version,
        ...(changeNote !== undefined && changeNote.trim() !== ''
          ? { change_note: changeNote.trim() }
          : {}),
      });
      set({
        versions: [created, ...get().versions],
        versionsStatus: 'success',
        versionsError: null,
        selectedVersionId: created.id,
      });
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'No se pudo crear la versión del schema.';
      set({ versionsStatus: 'error', versionsError: message });
    }
  },

  selectVersion: (id: string | null) => set({ selectedVersionId: id }),

  setVisualMode: (visualMode: boolean) => set({ visualMode, error: null, validationError: null }),

  setDraftSchema: (draftSchema: Record<string, unknown> | null) =>
    set({ draftSchema, validationStatus: 'idle', validationResult: null, validationError: null }),

  validate: async (data?: Record<string, unknown>) => {
    const { draftSchema } = get();
    if (draftSchema === null) {
      set({
        validationStatus: 'error',
        validationError: 'Construye un schema en el editor visual antes de validar.',
      });
      return;
    }
    const service = getSchemaService();
    if (service === null) {
      set({
        validationStatus: 'error',
        validationError: 'El editor de schemas no está disponible.',
      });
      return;
    }
    set({ validationStatus: 'loading', validationError: null });
    try {
      const result = await service.validate(draftSchema, data);
      set({ validationStatus: 'success', validationResult: result, validationError: null });
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'No se pudo validar el JSON Schema.';
      set({ validationStatus: 'error', validationError: message });
    }
  },

  reset: () =>
    set({
      status: 'idle',
      prompt: '',
      name: '',
      result: null,
      schemas: [],
      selectedSchemaId: null,
      versions: [],
      versionsStatus: 'idle',
      selectedVersionId: null,
      versionsError: null,
      error: null,
      visualMode: false,
      draftSchema: null,
      validationStatus: 'idle',
      validationResult: null,
      validationError: null,
    }),
}));
