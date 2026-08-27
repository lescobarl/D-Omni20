/**
 * Pruebas del panel del editor de JSON Schemas para desarrolladores.
 *
 * Contrato:
 * - Renderiza el formulario con nombre opcional, prompt y botón de generación.
 * - Carga la lista de schemas del tenant al montar (`fetchSchemas`).
 * - Ejecuta la generación vía `useSchemaStore.generate` con el servicio inyectado por DI.
 * - Muestra el JSON del schema generado o seleccionado en la vista diferida (Monaco).
 * - Maneja el estado de carga y de error de forma accesible.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeveloperSchemaPanel } from '@/components/Editor/Sidebar/DeveloperSchemaPanel';
import { setSchemaService, useSchemaStore } from '@/store/schemaStore';
import type { IDeveloperSchemaRead, ISchemaVersionRead } from '@/api/types';
import type { ISchemaGenerationResult, ISchemaService } from '@/services/schemaService';

/** Construye un resultado de generación válido con valores por defecto. */
function makeResult(overrides: Partial<ISchemaGenerationResult> = {}): ISchemaGenerationResult {
  return {
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Cliente',
      type: 'object',
      properties: { nombre: { type: 'string' } },
      required: ['nombre'],
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
    name: 'Cliente guardado',
    description: null,
    schema_json: { type: 'object', properties: { email: { type: 'string' } } },
    version: '1.0.0',
    created_at: '2026-08-18T00:00:00Z',
    revision: 1,
    updated_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Construye una versión guardada de un schema con valores por defecto. */
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
      properties: { telefono: { type: 'string' } },
      required: ['telefono'],
    },
    change_note: 'Añadido teléfono obligatorio',
    created_at: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/** Construye un servicio falso que registra llamadas y devuelve valores dados. */
function makeService(overrides: Partial<ISchemaService> = {}): ISchemaService {
  return {
    generate: vi.fn<ISchemaService['generate']>().mockResolvedValue(makeResult()),
    list: vi.fn<ISchemaService['list']>().mockResolvedValue([]),
    listVersions: vi.fn<ISchemaService['listVersions']>().mockResolvedValue([]),
    createVersion: vi.fn<ISchemaService['createVersion']>().mockResolvedValue(makeSchemaVersion()),
    validate: vi
      .fn<ISchemaService['validate']>()
      .mockResolvedValue({ valid: true, errors: 0, issues: [] }),
    ...overrides,
  };
}

describe('DeveloperSchemaPanel', () => {
  beforeEach(() => {
    useSchemaStore.getState().reset();
    setSchemaService(makeService());
  });

  afterEach(() => {
    // El reset corre con el componente aún montado (el cleanup de RTL se ejecuta
    // después, en orden LIFO). Se envuelve en `act` para que las actualizaciones
    // del store (status/result no-idle tras los tests de generación) no se
    // filtren fuera de su ámbito y disparen warnings de act().
    act(() => {
      useSchemaStore.getState().reset();
    });
    setSchemaService(null);
  });

  it('renderiza el formulario con nombre, prompt y botón de generación', async () => {
    render(<DeveloperSchemaPanel />);
    // Drena la carga asíncrona de la lista de schemas (`fetchSchemas`) del mount.
    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'Editor de Schemas' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre (opcional)')).toBeInTheDocument();
    expect(screen.getByLabelText(/Describe el JSON Schema/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar schema' })).toBeInTheDocument();
  });

  it('deshabilita el botón cuando el prompt está vacío', async () => {
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    expect(screen.getByRole('button', { name: 'Generar schema' })).toBeDisabled();
  });

  it('carga la lista de schemas del tenant al montar', async () => {
    const schema = makeSchema();
    setSchemaService(
      makeService({
        list: vi.fn<ISchemaService['list']>().mockResolvedValue([schema]),
      }),
    );
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'Schemas guardados' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cliente guardado/ })).toBeInTheDocument();
  });

  it('genera un schema y muestra la vista JSON', async () => {
    const user = userEvent.setup();
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    await act(async () => {
      await user.type(screen.getByLabelText(/Describe el JSON Schema/), 'Esquema de un cliente');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar schema' }));
    });
    // Drena la resolución de `generate` y la carga diferida de la vista Monaco.
    await act(async () => {});
    await act(async () => {});

    expect(await screen.findByRole('heading', { name: 'Cliente' })).toBeInTheDocument();
    // La vista diferida muestra el JSON en un `<code>` (mismo contrato de tests).
    expect(document.querySelector('code')?.textContent).toContain('"title": "Cliente"');
  });

  it('muestra el estado de carga mientras se genera', async () => {
    let resolve!: (value: ISchemaGenerationResult) => void;
    setSchemaService(
      makeService({
        generate: vi
          .fn<ISchemaService['generate']>()
          .mockImplementation(() => new Promise<ISchemaGenerationResult>((res) => (resolve = res))),
      }),
    );
    const user = userEvent.setup();
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    await act(async () => {
      await user.type(screen.getByLabelText(/Describe el JSON Schema/), 'Genera algo');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar schema' }));
    });
    await act(async () => {});

    expect(await screen.findByRole('button', { name: 'Generando…' })).toBeDisabled();
    expect(screen.getByText(/esto puede tardar unos segundos/)).toBeInTheDocument();

    await act(async () => {
      resolve(makeResult());
    });
    await act(async () => {});

    expect(await screen.findByRole('heading', { name: 'Cliente' })).toBeInTheDocument();
  });

  it('selecciona un schema guardado y muestra su JSON', async () => {
    const schema = makeSchema();
    setSchemaService(
      makeService({
        list: vi.fn<ISchemaService['list']>().mockResolvedValue([schema]),
      }),
    );
    const user = userEvent.setup();
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Cliente guardado/ }));
    });
    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'Cliente guardado' })).toBeInTheDocument();
    expect(document.querySelector('code')?.textContent).toContain('"email"');
  });

  it('muestra el mensaje de error de forma accesible', async () => {
    setSchemaService(
      makeService({
        generate: vi
          .fn<ISchemaService['generate']>()
          .mockRejectedValue(new Error('Servicio no disponible')),
      }),
    );
    const user = userEvent.setup();
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    await act(async () => {
      await user.type(screen.getByLabelText(/Describe el JSON Schema/), 'Genera algo');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Generar schema' }));
    });
    // Drena la resolución asíncrona del rechazo dentro de act.
    await act(async () => {});

    expect(await screen.findByRole('alert')).toHaveTextContent('Servicio no disponible');
  });

  it('abre el editor visual y muestra el árbol editable', async () => {
    const user = userEvent.setup();
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Abrir editor visual' }));
    });

    expect(useSchemaStore.getState().visualMode).toBe(true);
    expect(screen.getByRole('heading', { name: 'Editor visual de Schema' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Añadir propiedad' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar schema' })).toBeInTheDocument();
  });

  it('vuelve al formulario JSON desde el editor visual', async () => {
    const user = userEvent.setup();
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Abrir editor visual' }));
    });
    expect(screen.getByRole('heading', { name: 'Editor visual de Schema' })).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Volver al JSON' }));
    });

    expect(useSchemaStore.getState().visualMode).toBe(false);
    expect(screen.getByRole('heading', { name: 'Editor de Schemas' })).toBeInTheDocument();
  });

  it('muestra el bloque de versiones y sugiere la siguiente versión al seleccionar un schema', async () => {
    const schema = makeSchema();
    const listVersions = vi.fn<ISchemaService['listVersions']>().mockResolvedValue([]);
    setSchemaService(
      makeService({
        list: vi.fn<ISchemaService['list']>().mockResolvedValue([schema]),
        listVersions,
      }),
    );
    const user = userEvent.setup();
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Cliente guardado/ }));
    });
    await act(async () => {});
    await act(async () => {});

    expect(listVersions).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    expect(screen.getByRole('heading', { name: 'Versiones' })).toBeInTheDocument();
    // El número de versión siguiente se sugiere automáticamente (bump de '1.0.0' → '1.0.1').
    expect(screen.getByLabelText('Nueva versión')).toHaveValue('1.0.1');
    expect(screen.getByRole('button', { name: 'Crear versión' })).toBeInTheDocument();
  });

  it('crea una nueva versión con la nota del cambio y la muestra en la lista', async () => {
    const schema = makeSchema();
    const created = makeSchemaVersion({ version: '1.1.0', change_note: 'Añadido teléfono' });
    const createVersion = vi.fn<ISchemaService['createVersion']>().mockResolvedValue(created);
    setSchemaService(
      makeService({
        list: vi.fn<ISchemaService['list']>().mockResolvedValue([schema]),
        createVersion,
      }),
    );
    const user = userEvent.setup();
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Cliente guardado/ }));
    });
    await act(async () => {});

    await act(async () => {
      await user.clear(screen.getByLabelText('Nueva versión'));
    });
    await act(async () => {
      await user.type(screen.getByLabelText('Nueva versión'), '1.1.0');
    });
    await act(async () => {
      await user.type(screen.getByLabelText('Nota del cambio'), 'Añadido teléfono');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear versión' }));
    });
    await act(async () => {});
    await act(async () => {});

    expect(createVersion).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', {
      version: '1.1.0',
      change_note: 'Añadido teléfono',
    });
    expect(screen.getByRole('button', { name: /v1\.1\.0/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'v1.1.0' })).toBeInTheDocument();
  });

  it('selecciona una versión guardada y muestra su JSON', async () => {
    const schema = makeSchema();
    const version = makeSchemaVersion();
    setSchemaService(
      makeService({
        list: vi.fn<ISchemaService['list']>().mockResolvedValue([schema]),
        listVersions: vi.fn<ISchemaService['listVersions']>().mockResolvedValue([version]),
      }),
    );
    const user = userEvent.setup();
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Cliente guardado/ }));
    });
    await act(async () => {});
    await act(async () => {});

    // Antes de seleccionar la versión se muestra el JSON del schema ('email').
    expect(document.querySelector('code')?.textContent).toContain('"email"');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /v1\.0\.1/ }));
    });
    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'v1.0.1' })).toBeInTheDocument();
    expect(document.querySelector('code')?.textContent).toContain('"telefono"');
  });

  it('muestra el error de carga de versiones de forma accesible', async () => {
    const schema = makeSchema();
    setSchemaService(
      makeService({
        list: vi.fn<ISchemaService['list']>().mockResolvedValue([schema]),
        listVersions: vi
          .fn<ISchemaService['listVersions']>()
          .mockRejectedValue(new Error('Versiones caídas')),
      }),
    );
    const user = userEvent.setup();
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Cliente guardado/ }));
    });
    await act(async () => {});
    await act(async () => {});

    expect(await screen.findByRole('alert')).toHaveTextContent('Versiones caídas');
  });

  it('deshabilita el botón de crear versión sin número de versión', async () => {
    const schema = makeSchema();
    setSchemaService(
      makeService({
        list: vi.fn<ISchemaService['list']>().mockResolvedValue([schema]),
      }),
    );
    const user = userEvent.setup();
    render(<DeveloperSchemaPanel />);
    await act(async () => {});

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Cliente guardado/ }));
    });
    await act(async () => {});

    expect(screen.getByRole('button', { name: 'Crear versión' })).toBeEnabled();

    await act(async () => {
      await user.clear(screen.getByLabelText('Nueva versión'));
    });

    expect(screen.getByRole('button', { name: 'Crear versión' })).toBeDisabled();
  });
});
