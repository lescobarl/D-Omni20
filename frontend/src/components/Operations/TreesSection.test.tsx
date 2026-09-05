/**
 * Pruebas de la sección "Árboles" del área de operación del bot (B.3).
 *
 * Contrato:
 * - Carga los árboles de navegación al montar (una sola llamada a `listNavigationTrees`).
 * - Renderiza su eslabón del ciclo comercial (`Conversación ③`) para respetar el
 *   contrato de `OperationsArea` (todas las pestañas muestran su eslabón).
 * - CRUD completo: crear, editar, eliminar y estados vacío/error accesibles.
 * - La validación local exige el nombre antes de enviar.
 * - Las opciones se editan como texto `clave: etiqueta` por línea y se normalizan.
 */
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TreesSection } from '@/components/Operations/TreesSection';
import { setOperationsService, useOperationsStore } from '@/store/operationsStore';
import { makeNavigationTree, makePage, makeService } from '@/test/operationsMocks';

describe('TreesSection', () => {
  beforeEach(() => {
    useOperationsStore.getState().reset();
  });

  afterEach(() => {
    useOperationsStore.getState().reset();
    setOperationsService(null);
  });

  it('muestra el estado vacío y su eslabón del ciclo comercial', async () => {
    const service = makeService();
    setOperationsService(service);

    render(<TreesSection />);

    expect(await screen.findByText('Aún no hay árboles de navegación.')).toBeInTheDocument();
    expect(screen.getByText('Conversación ③')).toBeInTheDocument();
    expect(service.listNavigationTrees).toHaveBeenCalledTimes(1);
  });

  it('valida el nombre obligatorio antes de crear', async () => {
    const service = makeService();
    setOperationsService(service);
    const user = userEvent.setup();

    render(<TreesSection />);

    await screen.findByText('Aún no hay árboles de navegación.');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear árbol' }));
    });
    expect(screen.getByText('El nombre es obligatorio.')).toBeInTheDocument();
    expect(service.createNavigationTree).not.toHaveBeenCalled();
  });

  it('crea un árbol desde el formulario y lo agrega a la lista', async () => {
    const service = makeService({
      createNavigationTree: vi.fn(async () =>
        makeNavigationTree({
          name: 'Menú de ventas',
          options: [
            { key: 'saludar', label: 'Saludar' },
            { key: 'comprar', label: 'Comprar' },
          ],
        }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<TreesSection />);

    await screen.findByText('Aún no hay árboles de navegación.');
    await user.type(screen.getByLabelText('Nombre'), 'Menú de ventas');
    await user.click(screen.getByLabelText('Opciones'));
    await user.paste('saludar: Saludar\ncomprar: Comprar');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear árbol' }));
    });

    expect(service.createNavigationTree).toHaveBeenCalledWith({
      name: 'Menú de ventas',
      numOptions: 2,
      options: [
        { key: 'saludar', label: 'Saludar' },
        { key: 'comprar', label: 'Comprar' },
      ],
    });
    expect(await screen.findByText('Menú de ventas')).toBeInTheDocument();
  });

  it('lista los árboles de navegación con sus opciones', async () => {
    const service = makeService({
      listNavigationTrees: async () => makePage([makeNavigationTree()]),
    });
    setOperationsService(service);

    render(<TreesSection />);

    expect(await screen.findByText('Menú principal')).toBeInTheDocument();
    expect(screen.getByText('2 opciones')).toBeInTheDocument();
    expect(screen.getByText('saludar: Saludar')).toBeInTheDocument();
    expect(screen.getByText('comprar: Comprar')).toBeInTheDocument();
  });

  it('edita un árbol existente precargando el formulario', async () => {
    const service = makeService({
      listNavigationTrees: async () => makePage([makeNavigationTree()]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<TreesSection />);

    await screen.findByText('Menú principal');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    expect(screen.getByRole('form', { name: 'Editar árbol' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Menú principal');
    expect(screen.getByLabelText('Opciones')).toHaveValue('saludar: Saludar\ncomprar: Comprar');

    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Menú principal actualizado');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    });

    expect(service.updateNavigationTree).toHaveBeenCalledWith(
      '53333333-3333-4333-8333-333333333333',
      {
        name: 'Menú principal actualizado',
        numOptions: 2,
        options: [
          { key: 'saludar', label: 'Saludar' },
          { key: 'comprar', label: 'Comprar' },
        ],
      },
    );
  });

  it('elimina un árbol y vuelve al estado vacío', async () => {
    const service = makeService({
      listNavigationTrees: async () => makePage([makeNavigationTree()]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<TreesSection />);

    await screen.findByText('Menú principal');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(service.deleteNavigationTree).toHaveBeenCalledWith(
      '53333333-3333-4333-8333-333333333333',
    );
    expect(await screen.findByText('Aún no hay árboles de navegación.')).toBeInTheDocument();
  });

  it('muestra el error de carga de forma accesible', async () => {
    const service = makeService({
      listNavigationTrees: async () => {
        throw 'x';
      },
    });
    setOperationsService(service);

    render(<TreesSection />);

    expect(await screen.findByText('No se pudieron cargar los árboles.')).toBeInTheDocument();
  });
});
