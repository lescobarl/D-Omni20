/**
 * Pruebas de la sección "Plantillas" del área de operación del bot (B.5).
 *
 * Contrato:
 * - Carga las plantillas de mensaje al montar (una sola llamada a `listTemplates`).
 * - Renderiza su eslabón del ciclo comercial (`Conversación ③ · Cierre ⑥`) para
 *   respetar el contrato de `OperationsArea` (todas las pestañas muestran su eslabón).
 * - CRUD completo: crear, editar, eliminar y estados vacío/error accesibles.
 * - La validación local exige el nombre antes de enviar.
 */
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplatesSection } from '@/components/Operations/TemplatesSection';
import { setOperationsService, useOperationsStore } from '@/store/operationsStore';
import { makePage, makeService, makeTemplate } from '@/test/operationsMocks';

describe('TemplatesSection', () => {
  beforeEach(() => {
    useOperationsStore.getState().reset();
  });

  afterEach(() => {
    act(() => {
      useOperationsStore.getState().reset();
    });
    setOperationsService(null);
  });

  it('muestra el estado vacío y su eslabón del ciclo comercial', async () => {
    const service = makeService();
    setOperationsService(service);

    render(<TemplatesSection />);

    expect(await screen.findByText('Aún no hay plantillas de mensaje.')).toBeInTheDocument();
    expect(screen.getByText('Conversación ③ · Cierre ⑥')).toBeInTheDocument();
    expect(service.listTemplates).toHaveBeenCalledTimes(1);
  });

  it('valida el nombre obligatorio antes de crear', async () => {
    const service = makeService();
    setOperationsService(service);
    const user = userEvent.setup();

    render(<TemplatesSection />);

    await screen.findByText('Aún no hay plantillas de mensaje.');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear plantilla' }));
    });
    expect(screen.getByText('El nombre es obligatorio.')).toBeInTheDocument();
    expect(service.createTemplate).not.toHaveBeenCalled();
  });

  it('crea una plantilla desde el formulario y la agrega a la lista', async () => {
    const service = makeService({
      createTemplate: vi.fn(async () =>
        makeTemplate({
          name: 'Promo',
          body: 'Hola {{nombre}}, 20% off.',
          variables: ['nombre'],
        }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<TemplatesSection />);

    await screen.findByText('Aún no hay plantillas de mensaje.');

    await act(async () => {
      await user.type(screen.getByLabelText('Nombre'), 'Promo');
      await user.click(screen.getByLabelText('Cuerpo'));
      await user.paste('Hola {{nombre}}, 20% off.');
      await user.type(screen.getByLabelText('Variables'), 'nombre');
      await user.click(screen.getByRole('button', { name: 'Crear plantilla' }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(service.createTemplate).toHaveBeenCalledWith({
      name: 'Promo',
      body: 'Hola {{nombre}}, 20% off.',
      templateType: 'text',
      variables: ['nombre'],
    });
    expect(await screen.findByText('Promo')).toBeInTheDocument();
  });

  it('lista las plantillas de mensaje con sus datos', async () => {
    const service = makeService({
      listTemplates: async () => makePage([makeTemplate()]),
    });
    setOperationsService(service);

    render(<TemplatesSection />);

    expect(await screen.findByText('Bienvenida')).toBeInTheDocument();
    expect(screen.getByText('Hola {{nombre}}, bienvenido a OmniBotIA.')).toBeInTheDocument();
    expect(screen.getByText('Variables: nombre')).toBeInTheDocument();
    expect(screen.getByText('text')).toBeInTheDocument();
  });

  it('edita una plantilla existente precargando el formulario', async () => {
    const service = makeService({
      listTemplates: async () => makePage([makeTemplate()]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<TemplatesSection />);

    await screen.findByText('Bienvenida');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    expect(screen.getByRole('form', { name: 'Editar plantilla' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Bienvenida');
    expect(screen.getByLabelText('Cuerpo')).toHaveValue('Hola {{nombre}}, bienvenido a OmniBotIA.');
    expect(screen.getByLabelText('Tipo')).toHaveValue('text');
    expect(screen.getByLabelText('Variables')).toHaveValue('nombre');

    await act(async () => {
      await user.clear(screen.getByLabelText('Nombre'));
      await user.type(screen.getByLabelText('Nombre'), 'Promo de bienvenida');
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(service.updateTemplate).toHaveBeenCalledWith('52222222-2222-4222-8222-222222222222', {
      name: 'Promo de bienvenida',
      body: 'Hola {{nombre}}, bienvenido a OmniBotIA.',
      templateType: 'text',
      variables: ['nombre'],
    });
  });

  it('elimina una plantilla y vuelve al estado vacío', async () => {
    const service = makeService({
      listTemplates: async () => makePage([makeTemplate()]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<TemplatesSection />);

    await screen.findByText('Bienvenida');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(service.deleteTemplate).toHaveBeenCalledWith('52222222-2222-4222-8222-222222222222');
    expect(await screen.findByText('Aún no hay plantillas de mensaje.')).toBeInTheDocument();
  });

  it('muestra el error de carga de forma accesible', async () => {
    const service = makeService({
      listTemplates: async () => {
        throw 'x';
      },
    });
    setOperationsService(service);

    render(<TemplatesSection />);

    expect(await screen.findByText('No se pudieron cargar las plantillas.')).toBeInTheDocument();
  });
});
