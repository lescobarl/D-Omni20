/**
 * Pruebas del store del editor de JSON Schemas para desarrolladores.
 *
 * Contrato:
 * - El registro de servicios por DI (`setSchemaService`/`getSchemaService`) permite
 *   inyectar la implementación `ISchemaService` sin acoplar el store.
 * - `generate` valida el prompt y gestiona los estados
 *   `idle | loading | success | error`.
 * - `fetchSchemas` carga la lista del tenant sin tocar el estado del flujo.
 * - Sin servicio registrado el store degrada a estado de error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSchemaService, useSchemaStore } from '@/store/schemaStore';
import { AppError } from '@/lib/errors';
import type { IDeveloperSchemaRead, ISchemaVersionRead } from '@/api/types';
import type {
  ISchemaGenerationResult,
  ISchemaService,
  ISchemaValidationResult,
} from '@/services/schemaService';

/** Construye un resultado de generación válido con valores por defecto. */
function makeResult(overrides: Partial<ISchemaGenerationResult> = {}): ISchemaGenerationResult {
  return {
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Cliente',
      type: 'object',
    },
    model: 'deepseek-chat',
    cached: false,
    promptTokens: 40,
    completionTokens: 90,
    generatedAt: '2026-08-18T15:00:00Z',
    ...overrides,
  };
}

/** Construye un schema guardado del tenant con valores por defecto. */
function makeSchema(overrides: Partial<IDeveloperSchemaRead> = {}): IDeveloperSchemaRead {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    tenant_id: 'tenant-1',
    name: 'Cliente',
    description: null,
    schema_json: { type: 'object' },
    version: '1.0.0',
    created_at: '2026-08-18T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Fábrica de `ISchemaVersionRead` (DTO exacto del backend). */
function makeSchemaVersion(overrides: Partial<ISchemaVersionRead> = {}): ISchemaVersionRead {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenant_id: 'tenant-1',
    schema_id: '22222222-2222-4222-8222-222222222222',
    version: '1.0.1',
    schema_json: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Cliente',
      type: 'object',
      properties: { nombre: { type: 'string' } },
      required: ['nombre'],
    },
    change_note: 'Añadido campo obligatorio',
    created_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Construye un servicio con todas las dependencias mockeadas por defecto. */
function makeService(overrides: Partial<ISchemaService> = {}): ISchemaService {
  return {
    generate: vi.fn<ISchemaService['generate']>().mockResolvedValue(makeResult()),
    list: vi.fn<ISchemaService['list']>().mockResolvedValue([]),
    listVersions: vi.fn<ISchemaService['listVersions']>().mockResolvedValue([]),
    createVersion: vi.fn<ISchemaService['createVersion']>().mockResolvedValue(makeSchemaVersion()),
    validate: vi.fn<ISchemaService['validate']>().mockResolvedValue({
      valid: true,
      errors: 0,
      issues: [],
    }),
    ...overrides,
  };
}

describe('schemaStore', () => {
  beforeEach(() => {
    useSchemaStore.getState().reset();
  });

  afterEach(() => {
    useSchemaStore.getState().reset();
    setSchemaService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useSchemaStore.getState();
    expect(state.status).toBe('idle');
    expect(state.prompt).toBe('');
    expect(state.name).toBe('');
    expect(state.result).toBeNull();
    expect(state.schemas).toEqual([]);
    expect(state.selectedSchemaId).toBeNull();
    expect(state.error).toBeNull();
  });

  it('actualiza el prompt y el nombre sin disparar la generación', () => {
    useSchemaStore.getState().setPrompt('Esquema de un cliente');
    useSchemaStore.getState().setName('Cliente');

    const state = useSchemaStore.getState();
    expect(state.prompt).toBe('Esquema de un cliente');
    expect(state.name).toBe('Cliente');
    expect(state.status).toBe('idle');
  });

  it('limpia el error al escribir un nuevo prompt', async () => {
    useSchemaStore.getState().setPrompt('   ');
    await useSchemaStore.getState().generate();
    expect(useSchemaStore.getState().status).toBe('error');

    useSchemaStore.getState().setPrompt('Nuevo prompt');
    expect(useSchemaStore.getState().error).toBeNull();
  });

  it('genera un schema y almacena el resultado', async () => {
    const result = makeResult();
    const generate = vi.fn<ISchemaService['generate']>().mockResolvedValue(result);
    setSchemaService(makeService({ generate }));

    useSchemaStore.getState().setPrompt('  Esquema de un cliente  ');
    useSchemaStore.getState().setName('  Cliente  ');
    await useSchemaStore.getState().generate();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith('Esquema de un cliente', 'Cliente');

    const state = useSchemaStore.getState();
    expect(state.status).toBe('success');
    expect(state.result).toEqual(result);
    expect(state.selectedSchemaId).toBeNull();
    expect(state.error).toBeNull();
  });

  it('pasa a loading mientras la generación está pendiente', async () => {
    let resolve!: (value: ISchemaGenerationResult) => void;
    const generate = vi
      .fn<ISchemaService['generate']>()
      .mockImplementation(() => new Promise<ISchemaGenerationResult>((res) => (resolve = res)));
    setSchemaService(makeService({ generate }));

    useSchemaStore.getState().setPrompt('Prompt pendiente');
    const pending = useSchemaStore.getState().generate();

    expect(useSchemaStore.getState().status).toBe('loading');
    expect(useSchemaStore.getState().result).toBeNull();

    resolve(makeResult({ cached: true }));
    await pending;

    expect(useSchemaStore.getState().status).toBe('success');
    expect(useSchemaStore.getState().result?.cached).toBe(true);
  });

  it('rechaza la generación con prompt vacío sin invocar el servicio', async () => {
    const generate = vi.fn<ISchemaService['generate']>();
    setSchemaService(makeService({ generate }));

    useSchemaStore.getState().setPrompt('   ');
    await useSchemaStore.getState().generate();

    expect(generate).not.toHaveBeenCalled();
    expect(useSchemaStore.getState().status).toBe('error');
    expect(useSchemaStore.getState().error).toBe('Escribe un prompt antes de generar.');
  });

  it('degrade a error cuando no hay servicio registrado', async () => {
    setSchemaService(null);

    useSchemaStore.getState().setPrompt('Sin servicio');
    await useSchemaStore.getState().generate();

    expect(useSchemaStore.getState().status).toBe('error');
    expect(useSchemaStore.getState().error).toBe('El editor de schemas no está disponible.');
  });

  it('propaga el mensaje de un AppError del servicio', async () => {
    const generate = vi
      .fn<ISchemaService['generate']>()
      .mockRejectedValue(
        new AppError('Fallo de generación', 'schema.generate', { reason: 'model_timeout' }),
      );
    setSchemaService(makeService({ generate }));

    useSchemaStore.getState().setPrompt('Genera');
    await useSchemaStore.getState().generate();

    expect(useSchemaStore.getState().status).toBe('error');
    expect(useSchemaStore.getState().error).toBe('Fallo de generación');
  });

  it('propaga el mensaje de un Error genérico del servicio', async () => {
    const generate = vi.fn<ISchemaService['generate']>().mockRejectedValue(new Error('Red caída'));
    setSchemaService(makeService({ generate }));

    useSchemaStore.getState().setPrompt('Genera');
    await useSchemaStore.getState().generate();

    expect(useSchemaStore.getState().status).toBe('error');
    expect(useSchemaStore.getState().error).toBe('Red caída');
  });

  it('usa un mensaje por defecto cuando el error no es una instancia de Error', async () => {
    const generate = vi.fn<ISchemaService['generate']>().mockRejectedValue('fallo desconocido');
    setSchemaService(makeService({ generate }));

    useSchemaStore.getState().setPrompt('Genera');
    await useSchemaStore.getState().generate();

    expect(useSchemaStore.getState().status).toBe('error');
    expect(useSchemaStore.getState().error).toBe('No se pudo generar el JSON Schema.');
  });

  it('carga la lista de schemas del tenant sin tocar el estado del flujo', async () => {
    const schemas = [makeSchema()];
    const list = vi.fn<ISchemaService['list']>().mockResolvedValue(schemas);
    setSchemaService(makeService({ list }));

    useSchemaStore.getState().setPrompt('Preparado');
    await useSchemaStore.getState().fetchSchemas();

    expect(list).toHaveBeenCalledTimes(1);
    const state = useSchemaStore.getState();
    expect(state.schemas).toEqual(schemas);
    expect(state.error).toBeNull();
    // fetchSchemas no compite con el estado del flujo de generación.
    expect(state.status).toBe('idle');
  });

  it('degrade a error en fetchSchemas sin servicio registrado', async () => {
    setSchemaService(null);

    await useSchemaStore.getState().fetchSchemas();

    expect(useSchemaStore.getState().status).toBe('error');
    expect(useSchemaStore.getState().error).toBe('El editor de schemas no está disponible.');
  });

  it('propaga el error de carga de la lista de schemas', async () => {
    const list = vi.fn<ISchemaService['list']>().mockRejectedValue(new Error('Lista caída'));
    setSchemaService(makeService({ list }));

    await useSchemaStore.getState().fetchSchemas();

    expect(useSchemaStore.getState().status).toBe('error');
    expect(useSchemaStore.getState().error).toBe('Lista caída');
  });

  it('selecciona un schema de la lista para inspeccionarlo', () => {
    useSchemaStore.getState().selectSchema('22222222-2222-4222-8222-222222222222');
    expect(useSchemaStore.getState().selectedSchemaId).toBe('22222222-2222-4222-8222-222222222222');

    useSchemaStore.getState().selectSchema(null);
    expect(useSchemaStore.getState().selectedSchemaId).toBeNull();
  });

  it('reset descarta el resultado y vuelve al estado inicial', async () => {
    const version = makeSchemaVersion();
    setSchemaService(
      makeService({
        listVersions: vi.fn<ISchemaService['listVersions']>().mockResolvedValue([version]),
      }),
    );

    useSchemaStore.getState().setPrompt('Genera');
    useSchemaStore.getState().setName('Cliente');
    await useSchemaStore.getState().generate();
    await useSchemaStore.getState().fetchSchemas();
    useSchemaStore.getState().selectSchema('22222222-2222-4222-8222-222222222222');
    await useSchemaStore.getState().fetchVersions('22222222-2222-4222-8222-222222222222');
    useSchemaStore.getState().selectVersion('33333333-3333-4333-8333-333333333333');
    expect(useSchemaStore.getState().status).toBe('success');
    expect(useSchemaStore.getState().versions).toEqual([version]);
    expect(useSchemaStore.getState().selectedVersionId).toBe(
      '33333333-3333-4333-8333-333333333333',
    );

    useSchemaStore.getState().reset();

    const state = useSchemaStore.getState();
    expect(state.status).toBe('idle');
    expect(state.prompt).toBe('');
    expect(state.name).toBe('');
    expect(state.result).toBeNull();
    expect(state.schemas).toEqual([]);
    expect(state.selectedSchemaId).toBeNull();
    expect(state.versions).toEqual([]);
    expect(state.versionsStatus).toBe('idle');
    expect(state.selectedVersionId).toBeNull();
    expect(state.versionsError).toBeNull();
    expect(state.error).toBeNull();
  });

  it('setVisualMode alterna el modo visual y limpia los errores', () => {
    useSchemaStore.getState().setVisualMode(true);
    expect(useSchemaStore.getState().visualMode).toBe(true);

    useSchemaStore.getState().setVisualMode(false);
    expect(useSchemaStore.getState().visualMode).toBe(false);
  });

  it('setDraftSchema guarda el borrador y reinicia la validación', () => {
    const schema = { type: 'object', properties: { nombre: { type: 'string' } } };
    useSchemaStore.getState().setDraftSchema(schema);

    const state = useSchemaStore.getState();
    expect(state.draftSchema).toEqual(schema);
    expect(state.validationStatus).toBe('idle');
    expect(state.validationResult).toBeNull();
    expect(state.validationError).toBeNull();
  });

  it('valida el borrador y almacena el resultado', async () => {
    const result = { valid: true, errors: 0, issues: [] };
    const validate = vi.fn<ISchemaService['validate']>().mockResolvedValue(result);
    setSchemaService(makeService({ validate }));

    useSchemaStore.getState().setDraftSchema({ type: 'object' });
    await useSchemaStore.getState().validate();

    expect(validate).toHaveBeenCalledTimes(1);
    const state = useSchemaStore.getState();
    expect(state.validationStatus).toBe('success');
    expect(state.validationResult).toEqual(result);
    expect(state.validationError).toBeNull();
  });

  it('pasa a loading mientras la validación está pendiente', async () => {
    let resolve!: (value: ISchemaValidationResult) => void;
    const validate = vi
      .fn<ISchemaService['validate']>()
      .mockImplementation(() => new Promise<ISchemaValidationResult>((res) => (resolve = res)));
    setSchemaService(makeService({ validate }));

    useSchemaStore.getState().setDraftSchema({ type: 'object' });
    const pending = useSchemaStore.getState().validate();

    expect(useSchemaStore.getState().validationStatus).toBe('loading');

    resolve({ valid: true, errors: 0, issues: [] });
    await pending;

    expect(useSchemaStore.getState().validationStatus).toBe('success');
  });

  it('rechaza validar sin borrador en el editor visual', async () => {
    const validate = vi.fn<ISchemaService['validate']>();
    setSchemaService(makeService({ validate }));

    await useSchemaStore.getState().validate();

    expect(validate).not.toHaveBeenCalled();
    expect(useSchemaStore.getState().validationStatus).toBe('error');
    expect(useSchemaStore.getState().validationError).toBe(
      'Construye un schema en el editor visual antes de validar.',
    );
  });

  it('degrade a error en validate sin servicio registrado', async () => {
    setSchemaService(null);

    useSchemaStore.getState().setDraftSchema({ type: 'object' });
    await useSchemaStore.getState().validate();

    expect(useSchemaStore.getState().validationStatus).toBe('error');
    expect(useSchemaStore.getState().validationError).toBe(
      'El editor de schemas no está disponible.',
    );
  });

  it('propaga el mensaje de un error de validación del servicio', async () => {
    const validate = vi
      .fn<ISchemaService['validate']>()
      .mockRejectedValue(new Error('Validación caída'));
    setSchemaService(makeService({ validate }));

    useSchemaStore.getState().setDraftSchema({ type: 'object' });
    await useSchemaStore.getState().validate();

    expect(useSchemaStore.getState().validationStatus).toBe('error');
    expect(useSchemaStore.getState().validationError).toBe('Validación caída');
  });

  it('carga las versiones de un schema seleccionado', async () => {
    const version = makeSchemaVersion();
    const listVersions = vi.fn<ISchemaService['listVersions']>().mockResolvedValue([version]);
    setSchemaService(makeService({ listVersions }));
    useSchemaStore.getState().selectSchema('22222222-2222-4222-8222-222222222222');

    await useSchemaStore.getState().fetchVersions('22222222-2222-4222-8222-222222222222');

    expect(listVersions).toHaveBeenCalledTimes(1);
    expect(listVersions).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    const state = useSchemaStore.getState();
    expect(state.versions).toEqual([version]);
    expect(state.versionsStatus).toBe('success');
    expect(state.versionsError).toBeNull();
  });

  it('pasa a loading mientras se cargan las versiones', async () => {
    let resolve!: (value: ISchemaVersionRead[]) => void;
    const listVersions = vi
      .fn<ISchemaService['listVersions']>()
      .mockImplementation(() => new Promise<ISchemaVersionRead[]>((res) => (resolve = res)));
    setSchemaService(makeService({ listVersions }));

    const pending = useSchemaStore.getState().fetchVersions('22222222-2222-4222-8222-222222222222');

    expect(useSchemaStore.getState().versionsStatus).toBe('loading');

    resolve([makeSchemaVersion()]);
    await pending;

    expect(useSchemaStore.getState().versionsStatus).toBe('success');
    expect(useSchemaStore.getState().versions).toHaveLength(1);
  });

  it('degrade a error en fetchVersions sin servicio registrado', async () => {
    setSchemaService(null);

    await useSchemaStore.getState().fetchVersions('22222222-2222-4222-8222-222222222222');

    expect(useSchemaStore.getState().versionsStatus).toBe('error');
    expect(useSchemaStore.getState().versionsError).toBe(
      'El editor de schemas no está disponible.',
    );
  });

  it('propaga el mensaje de error al cargar las versiones', async () => {
    const listVersions = vi
      .fn<ISchemaService['listVersions']>()
      .mockRejectedValue(new Error('Versiones caídas'));
    setSchemaService(makeService({ listVersions }));

    await useSchemaStore.getState().fetchVersions('22222222-2222-4222-8222-222222222222');

    expect(useSchemaStore.getState().versionsStatus).toBe('error');
    expect(useSchemaStore.getState().versionsError).toBe('Versiones caídas');
  });

  it('crea una versión del schema seleccionado con la nota recortada', async () => {
    const created = makeSchemaVersion({
      id: '44444444-4444-4444-8444-444444444444',
    });
    const createVersion = vi.fn<ISchemaService['createVersion']>().mockResolvedValue(created);
    setSchemaService(makeService({ createVersion }));
    useSchemaStore.getState().selectSchema('22222222-2222-4222-8222-222222222222');

    await useSchemaStore.getState().createVersion('1.0.1', '  Añadido campo obligatorio  ');

    expect(createVersion).toHaveBeenCalledTimes(1);
    expect(createVersion).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', {
      version: '1.0.1',
      change_note: 'Añadido campo obligatorio',
    });
    const state = useSchemaStore.getState();
    expect(state.versionsStatus).toBe('success');
    expect(state.versions[0]).toBe(created);
    expect(state.selectedVersionId).toBe(created.id);
    expect(state.versionsError).toBeNull();
  });

  it('omite la nota del cambio cuando es solo espacios', async () => {
    const created = makeSchemaVersion();
    const createVersion = vi.fn<ISchemaService['createVersion']>().mockResolvedValue(created);
    setSchemaService(makeService({ createVersion }));
    useSchemaStore.getState().selectSchema('22222222-2222-4222-8222-222222222222');

    await useSchemaStore.getState().createVersion('1.1.0', '   ');

    expect(createVersion).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', {
      version: '1.1.0',
    });
  });

  it('antepone la versión creada a las versiones ya cargadas', async () => {
    const previous = makeSchemaVersion({ version: '1.0.1' });
    const created = makeSchemaVersion({
      id: '44444444-4444-4444-8444-444444444444',
      version: '2.0.0',
    });
    setSchemaService(
      makeService({
        listVersions: vi.fn<ISchemaService['listVersions']>().mockResolvedValue([previous]),
        createVersion: vi.fn<ISchemaService['createVersion']>().mockResolvedValue(created),
      }),
    );
    useSchemaStore.getState().selectSchema('22222222-2222-4222-8222-222222222222');
    await useSchemaStore.getState().fetchVersions('22222222-2222-4222-8222-222222222222');
    expect(useSchemaStore.getState().versions).toEqual([previous]);

    await useSchemaStore.getState().createVersion('2.0.0');

    expect(useSchemaStore.getState().versions).toEqual([created, previous]);
  });

  it('rechaza crear una versión sin schema seleccionado', async () => {
    const createVersion = vi.fn<ISchemaService['createVersion']>();
    setSchemaService(makeService({ createVersion }));

    await useSchemaStore.getState().createVersion('1.0.1');

    expect(createVersion).not.toHaveBeenCalled();
    expect(useSchemaStore.getState().versionsStatus).toBe('error');
    expect(useSchemaStore.getState().versionsError).toBe('Selecciona un schema para versionarlo.');
  });

  it('degrade a error en createVersion sin servicio registrado', async () => {
    setSchemaService(null);
    useSchemaStore.getState().selectSchema('22222222-2222-4222-8222-222222222222');

    await useSchemaStore.getState().createVersion('1.0.1');

    expect(useSchemaStore.getState().versionsStatus).toBe('error');
    expect(useSchemaStore.getState().versionsError).toBe(
      'El editor de schemas no está disponible.',
    );
  });

  it('propaga el mensaje de error al crear una versión', async () => {
    const createVersion = vi
      .fn<ISchemaService['createVersion']>()
      .mockRejectedValue(new Error('Creación caída'));
    setSchemaService(makeService({ createVersion }));
    useSchemaStore.getState().selectSchema('22222222-2222-4222-8222-222222222222');

    await useSchemaStore.getState().createVersion('1.0.1');

    expect(useSchemaStore.getState().versionsStatus).toBe('error');
    expect(useSchemaStore.getState().versionsError).toBe('Creación caída');
  });

  it('selecciona una versión de la lista para inspeccionarla', () => {
    useSchemaStore.getState().selectVersion('33333333-3333-4333-8333-333333333333');
    expect(useSchemaStore.getState().selectedVersionId).toBe(
      '33333333-3333-4333-8333-333333333333',
    );

    useSchemaStore.getState().selectVersion(null);
    expect(useSchemaStore.getState().selectedVersionId).toBeNull();
  });

  it('selectSchema reinicia el estado de versiones al cambiar de schema', async () => {
    setSchemaService(
      makeService({
        listVersions: vi
          .fn<ISchemaService['listVersions']>()
          .mockResolvedValue([makeSchemaVersion()]),
      }),
    );
    useSchemaStore.getState().selectSchema('22222222-2222-4222-8222-222222222222');
    await useSchemaStore.getState().fetchVersions('22222222-2222-4222-8222-222222222222');
    useSchemaStore.getState().selectVersion('33333333-3333-4333-8333-333333333333');
    expect(useSchemaStore.getState().versions).toHaveLength(1);

    useSchemaStore.getState().selectSchema('55555555-5555-4555-8555-555555555555');

    const state = useSchemaStore.getState();
    expect(state.selectedSchemaId).toBe('55555555-5555-4555-8555-555555555555');
    expect(state.versions).toEqual([]);
    expect(state.versionsStatus).toBe('idle');
    expect(state.selectedVersionId).toBeNull();
    expect(state.versionsError).toBeNull();
  });
});
