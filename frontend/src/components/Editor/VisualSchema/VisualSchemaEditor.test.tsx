/**
 * Pruebas del editor visual de JSON Schemas (Draft 2020-12).
 *
 * Contrato:
 * - Convierte el borrador del store (`draftSchema`) a un árbol editable (`SchemaNode`).
 * - "+ Añadir propiedad" añade una propiedad al objeto raíz y actualiza el borrador.
 * - "Validar schema" delega en `useSchemaStore.validate` con el servicio inyectado por DI.
 * - Muestra el resultado de la validación (válido / incidencias) o el error de forma
 *   accesible (`role="status"` / `role="alert"`).
 * - "Volver al JSON" desactiva el modo visual (`setVisualMode(false)`).
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisualSchemaEditor } from '@/components/Editor/VisualSchema/VisualSchemaEditor';
import { setSchemaService, useSchemaStore } from '@/store/schemaStore';
import type { ISchemaService } from '@/services/schemaService';

/** Construye un servicio falso con validación por defecto (schema válido). */
function makeService(overrides: Partial<ISchemaService> = {}): ISchemaService {
  return {
    generate: vi.fn<ISchemaService['generate']>(),
    list: vi.fn<ISchemaService['list']>().mockResolvedValue([]),
    listVersions: vi.fn<ISchemaService['listVersions']>().mockResolvedValue([]),
    createVersion: vi.fn<ISchemaService['createVersion']>(),
    validate: vi
      .fn<ISchemaService['validate']>()
      .mockResolvedValue({ valid: true, errors: 0, issues: [] }),
    ...overrides,
  };
}

/** Siembra un borrador de schema en el store antes de renderizar el editor. */
function seedDraftSchema(): void {
  useSchemaStore.getState().setDraftSchema({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    title: 'Cliente',
    properties: { nombre: { type: 'string' } },
    required: ['nombre'],
  });
}

describe('VisualSchemaEditor', () => {
  beforeEach(() => {
    useSchemaStore.getState().reset();
    setSchemaService(makeService());
  });

  afterEach(() => {
    act(() => {
      useSchemaStore.getState().reset();
    });
    setSchemaService(null);
  });

  it('renderiza el árbol con la vista previa JSON y las acciones', () => {
    seedDraftSchema();
    render(<VisualSchemaEditor />);

    expect(screen.getByRole('heading', { name: 'Editor visual de Schema' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Añadir propiedad' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validar schema' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver al JSON' })).toBeInTheDocument();
    expect(screen.getByText('Vista previa JSON')).toBeInTheDocument();
  });

  it('añade una propiedad hija y actualiza el borrador del store', async () => {
    const user = userEvent.setup();
    seedDraftSchema();
    render(<VisualSchemaEditor />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: '+ Añadir propiedad' }));
    });

    const draft = useSchemaStore.getState().draftSchema;
    expect(draft).not.toBeNull();
    const properties = (draft as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties)).toContain('propiedad');
  });

  it('valida un schema válido y muestra la confirmación', async () => {
    const user = userEvent.setup();
    seedDraftSchema();
    render(<VisualSchemaEditor />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Validar schema' }));
    });
    await act(async () => {});

    expect(useSchemaStore.getState().validationStatus).toBe('success');
    expect(await screen.findByText('El schema es válido (0 incidencias).')).toBeInTheDocument();
  });

  it('muestra las incidencias cuando el schema no es válido', async () => {
    const user = userEvent.setup();
    setSchemaService(
      makeService({
        validate: vi.fn<ISchemaService['validate']>().mockResolvedValue({
          valid: false,
          errors: 1,
          issues: [{ path: 'properties.nombre', message: 'no es de tipo string', keyword: 'type' }],
        }),
      }),
    );
    seedDraftSchema();
    render(<VisualSchemaEditor />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Validar schema' }));
    });
    await act(async () => {});

    expect(await screen.findByText('El schema tiene 1 incidencia(s).')).toBeInTheDocument();
    expect(screen.getByText(/no es de tipo string/)).toBeInTheDocument();
  });

  it('muestra el error de validación de forma accesible', async () => {
    const user = userEvent.setup();
    setSchemaService(
      makeService({
        validate: vi
          .fn<ISchemaService['validate']>()
          .mockRejectedValue(new Error('Validación caída')),
      }),
    );
    seedDraftSchema();
    render(<VisualSchemaEditor />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Validar schema' }));
    });
    await act(async () => {});

    expect(await screen.findByRole('alert')).toHaveTextContent('Validación caída');
  });

  it('vuelve al JSON desactivando el modo visual', async () => {
    const user = userEvent.setup();
    useSchemaStore.getState().setVisualMode(true);
    seedDraftSchema();
    render(<VisualSchemaEditor />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Volver al JSON' }));
    });

    expect(useSchemaStore.getState().visualMode).toBe(false);
  });
});
