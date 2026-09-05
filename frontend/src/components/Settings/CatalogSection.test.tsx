import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CatalogSection } from '@/components/Settings/CatalogSection';
import { setTenantConfigService, useTenantConfigStore } from '@/store/tenantConfigStore';
import { makeCatalogItem, makePage, makeService } from '@/test/tenantConfigMocks';

describe('CatalogSection', () => {
  beforeEach(() => {
    useTenantConfigStore.getState().reset();
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    useTenantConfigStore.getState().reset();
    setTenantConfigService(null);
    document.documentElement.removeAttribute('style');
  });

  it('muestra el estado vacío cuando no hay ítems en el catálogo', async () => {
    const service = makeService();
    setTenantConfigService(service);

    render(<CatalogSection />);

    expect(await screen.findByText('Aún no hay ítems en el catálogo.')).toBeInTheDocument();
    expect(service.listCatalogItems).toHaveBeenCalledTimes(1);
  });

  it('valida los campos obligatorios y el precio', async () => {
    const service = makeService();
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<CatalogSection />);

    await screen.findByRole('form', { name: 'Crear ítem del catálogo' });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear ítem' }));
    });
    expect(screen.getByText('El SKU y el nombre son obligatorios.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('SKU'), 'PROD-002');
    await user.type(screen.getByLabelText('Nombre'), 'Consulta médica general');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear ítem' }));
    });
    expect(screen.getByText('Ingresa un precio válido mayor o igual a cero.')).toBeInTheDocument();
    expect(service.createCatalogItem).not.toHaveBeenCalled();
  });

  it('crea un ítem del catálogo normalizando la moneda a mayúsculas', async () => {
    const service = makeService();
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<CatalogSection />);

    await screen.findByRole('form', { name: 'Crear ítem del catálogo' });
    await user.type(screen.getByLabelText('SKU'), 'PROD-002');
    await user.type(screen.getByLabelText('Nombre'), 'Consulta médica general');
    await user.type(screen.getByLabelText('Precio'), '150.5');

    const currencyInput = screen.getByLabelText('Moneda');
    await user.clear(currencyInput);
    await user.type(currencyInput, 'usd');
    expect(currencyInput).toHaveValue('USD');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear ítem' }));
    });

    expect(service.createCatalogItem).toHaveBeenCalledWith({
      sku: 'PROD-002',
      name: 'Consulta médica general',
      description: undefined,
      price: 150.5,
      currency: 'USD',
      available: true,
    });
  });

  it('lista los ítems con precio formateado y estado de disponibilidad', async () => {
    const service = makeService({
      listCatalogItems: async () => makePage([makeCatalogItem()]),
    });
    setTenantConfigService(service);

    render(<CatalogSection />);

    expect(await screen.findByText('Consultoría OmniBotIA')).toBeInTheDocument();
    expect(screen.getByText('SKU-001')).toBeInTheDocument();
    expect(screen.getByText('Disponible')).toBeInTheDocument();
    expect(screen.getByText('USD 99.90')).toBeInTheDocument();
  });

  it('edita un ítem existente precargando el formulario', async () => {
    const service = makeService({
      listCatalogItems: async () => makePage([makeCatalogItem()]),
    });
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<CatalogSection />);

    await screen.findByText('Consultoría OmniBotIA');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    expect(screen.getByRole('form', { name: 'Editar ítem del catálogo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Precio')).toHaveValue(99.9);
    expect(screen.getByLabelText('Moneda')).toHaveValue('usd');

    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Consultoría Premium');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    });

    expect(service.updateCatalogItem).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333', {
      sku: 'SKU-001',
      name: 'Consultoría Premium',
      description: undefined,
      price: 99.9,
      currency: 'usd',
      available: true,
    });
  });

  it('elimina un ítem del catálogo', async () => {
    const service = makeService({
      listCatalogItems: async () => makePage([makeCatalogItem()]),
    });
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<CatalogSection />);

    await screen.findByText('Consultoría OmniBotIA');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(service.deleteCatalogItem).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333');
  });

  it('muestra el error de carga de forma accesible', async () => {
    const service = makeService({
      listCatalogItems: async () => {
        throw 'x';
      },
    });
    setTenantConfigService(service);

    render(<CatalogSection />);

    expect(await screen.findByText('No se pudo cargar el catálogo.')).toBeInTheDocument();
  });
});
