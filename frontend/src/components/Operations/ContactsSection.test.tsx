/**
 * Pruebas de la sección "Contactos" del área de operación del bot (B.6).
 *
 * Contrato:
 * - Carga el directorio de contactos al montar (una sola llamada a `listContacts`).
 * - Renderiza su eslabón del ciclo comercial (`Captación ①`) para respetar el
 *   contrato de `OperationsArea` (todas las pestañas muestran su eslabón).
 * - CRUD completo: crear, editar, eliminar y estados vacío/error accesibles.
 * - La validación local exige el teléfono antes de enviar.
 */
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactsSection } from '@/components/Operations/ContactsSection';
import { setOperationsService, useOperationsStore } from '@/store/operationsStore';
import { makeContact, makePage, makeService } from '@/test/operationsMocks';

describe('ContactsSection', () => {
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

    render(<ContactsSection />);

    expect(await screen.findByText('Aún no hay contactos en el directorio.')).toBeInTheDocument();
    expect(screen.getByText('Captación ①')).toBeInTheDocument();
    expect(service.listContacts).toHaveBeenCalledTimes(1);
  });

  it('valida el teléfono obligatorio antes de crear', async () => {
    const service = makeService();
    setOperationsService(service);
    const user = userEvent.setup();

    render(<ContactsSection />);

    await screen.findByText('Aún no hay contactos en el directorio.');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear contacto' }));
    });
    expect(screen.getByText('El teléfono es obligatorio.')).toBeInTheDocument();
    expect(service.createContact).not.toHaveBeenCalled();
  });

  it('crea un contacto desde el formulario y lo agrega al directorio', async () => {
    const service = makeService({
      createContact: vi.fn(async () =>
        makeContact({
          phone: '+529998887766',
          name: 'Luis Pérez',
          email: 'luis@example.com',
          tags: ['ventas', 'vip'],
        }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<ContactsSection />);

    await screen.findByText('Aún no hay contactos en el directorio.');
    await user.type(screen.getByLabelText('Teléfono'), '+529998887766');
    await user.type(screen.getByLabelText('Nombre'), 'Luis Pérez');
    await user.type(screen.getByLabelText('Correo'), 'luis@example.com');
    await user.type(screen.getByLabelText('Etiquetas'), 'ventas, vip');
    await user.type(screen.getByLabelText('Id externo'), 'wa:529998887766');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear contacto' }));
    });

    expect(service.createContact).toHaveBeenCalledWith({
      phone: '+529998887766',
      name: 'Luis Pérez',
      email: 'luis@example.com',
      tags: ['ventas', 'vip'],
      state: 'new',
      source: 'manual',
      externalContactId: 'wa:529998887766',
    });
    expect(await screen.findByText('Luis Pérez')).toBeInTheDocument();
  });

  it('lista los contactos del directorio con sus datos', async () => {
    const service = makeService({
      listContacts: async () => makePage([makeContact()]),
    });
    setOperationsService(service);

    render(<ContactsSection />);

    expect(await screen.findByText('Ana García')).toBeInTheDocument();
    expect(screen.getByText('+521234567890')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByText('#ventas')).toBeInTheDocument();
    expect(screen.getByText('Origen: manual')).toBeInTheDocument();
  });

  it('edita un contacto existente precargando el formulario', async () => {
    const service = makeService({
      listContacts: async () => makePage([makeContact()]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<ContactsSection />);

    await screen.findByText('Ana García');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    expect(screen.getByRole('form', { name: 'Editar contacto' })).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toHaveValue('+521234567890');
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana García');
    expect(screen.getByLabelText('Correo')).toHaveValue('ana@example.com');
    expect(screen.getByLabelText('Etiquetas')).toHaveValue('ventas');
    expect(screen.getByLabelText('Estado')).toHaveValue('new');
    expect(screen.getByLabelText('Origen')).toHaveValue('manual');

    await user.clear(screen.getByLabelText('Teléfono'));
    await user.type(screen.getByLabelText('Teléfono'), '+529998887766');
    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Luis Pérez');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    });

    expect(service.updateContact).toHaveBeenCalledWith('51111111-1111-4111-8111-111111111111', {
      phone: '+529998887766',
      name: 'Luis Pérez',
      email: 'ana@example.com',
      tags: ['ventas'],
      state: 'new',
      source: 'manual',
      externalContactId: undefined,
    });
  });

  it('elimina un contacto y vuelve al estado vacío', async () => {
    const service = makeService({
      listContacts: async () => makePage([makeContact()]),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<ContactsSection />);

    await screen.findByText('Ana García');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(service.deleteContact).toHaveBeenCalledWith('51111111-1111-4111-8111-111111111111');
    expect(await screen.findByText('Aún no hay contactos en el directorio.')).toBeInTheDocument();
  });

  it('muestra el error de carga de forma accesible', async () => {
    const service = makeService({
      listContacts: async () => {
        throw 'x';
      },
    });
    setOperationsService(service);

    render(<ContactsSection />);

    expect(await screen.findByText('No se pudieron cargar los contactos.')).toBeInTheDocument();
  });
});
