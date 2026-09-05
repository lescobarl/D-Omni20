/**
 * Pruebas de la sección de captación publicitaria (C-1 — eslabón ①).
 *
 * Cubren el CRUD de campañas publicitarias con atribución UTM sobre el store
 * `useAdsStore` con el servicio inyectado (`setAdsService`): estado vacío,
 * validación local del nombre obligatorio, creación, listado, edición
 * precargada, eliminación y error de carga accesible.
 */
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdsSection } from '@/components/Ads/AdsSection';
import { setAdsService, useAdsStore } from '@/store/adsStore';
import { setLandingService } from '@/store/editorStore';
import {
  makeAdCampaign,
  makeAdsService,
  makeLanding,
  makeLandingService,
  makePage,
} from '@/test/adsMocks';

describe('AdsSection', () => {
  beforeEach(() => {
    useAdsStore.getState().reset();
  });

  afterEach(() => {
    useAdsStore.getState().reset();
    setAdsService(null);
    setLandingService(null);
  });

  it('muestra el estado vacío y su eslabón del ciclo comercial', async () => {
    const service = makeAdsService();
    setAdsService(service);
    render(<AdsSection />);

    expect(await screen.findByText('Aún no hay campañas publicitarias.')).toBeInTheDocument();
    expect(screen.getByText('Captación ①')).toBeInTheDocument();
    expect(service.listAdCampaigns).toHaveBeenCalledTimes(1);
  });

  it('valida el nombre obligatorio antes de crear', async () => {
    const service = makeAdsService();
    setAdsService(service);
    render(<AdsSection />);

    await screen.findByText('Aún no hay campañas publicitarias.');
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear campaña' }));
    });

    expect(screen.getByText('El nombre de la campaña es obligatorio.')).toBeInTheDocument();
    expect(service.createAdCampaign).not.toHaveBeenCalled();
  });

  it('crea una campaña desde el formulario y la agrega a la lista', async () => {
    const service = makeAdsService({
      createAdCampaign: vi.fn(async () =>
        makeAdCampaign({
          name: 'Verano Tequesquitengo',
          utm_source: 'meta',
          utm_medium: 'cpc',
          utm_campaign: 'verano-lago',
          utm_content: 'banner',
          utm_term: 'lago',
          budget_minor: 150000,
          notes: 'Campaña de verano',
        }),
      ),
    });
    const landingService = makeLandingService({
      list: async () => makePage([makeLanding({ name: 'Landing Verano' })]),
    });
    setAdsService(service);
    setLandingService(landingService);
    render(<AdsSection />);

    await screen.findByText('Aún no hay campañas publicitarias.');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre'), 'Verano Tequesquitengo');
    await user.type(screen.getByLabelText('UTM Fuente'), 'meta');
    await user.type(screen.getByLabelText('UTM Medio'), 'cpc');
    await user.type(screen.getByLabelText('UTM Campaña'), 'verano-lago');
    await user.type(screen.getByLabelText('UTM Contenido'), 'banner');
    await user.type(screen.getByLabelText('UTM Término'), 'lago');
    await user.type(screen.getByLabelText('Presupuesto (centavos)'), '150000');
    await user.type(screen.getByLabelText('Notas'), 'Campaña de verano');
    await user.selectOptions(screen.getByLabelText('Landing de destino'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear campaña' }));
    });

    expect(service.createAdCampaign).toHaveBeenCalledWith({
      name: 'Verano Tequesquitengo',
      status: 'active',
      enabled: true,
      utmSource: 'meta',
      utmMedium: 'cpc',
      utmCampaign: 'verano-lago',
      utmContent: 'banner',
      utmTerm: 'lago',
      landingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      budgetMinor: 150000,
      startAt: undefined,
      endAt: undefined,
      notes: 'Campaña de verano',
    });
    expect(await screen.findByText('Verano Tequesquitengo')).toBeInTheDocument();
  });

  it('lista las campañas publicitarias con sus datos', async () => {
    const service = makeAdsService({
      listAdCampaigns: async () => makePage([makeAdCampaign()]),
    });
    setAdsService(service);
    render(<AdsSection />);

    expect(await screen.findByText('Casa vista al lago Tequesquitengo')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('tequesquitengo-lago')).toBeInTheDocument();
  });

  it('muestra las landings reales en el selector de destino y permite limpiarlo', async () => {
    const service = makeAdsService({
      createAdCampaign: vi.fn(async () => makeAdCampaign({ name: 'Campaña sin landing' })),
    });
    const landingService = makeLandingService({
      list: async () =>
        makePage([
          makeLanding({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Landing Verano' }),
          makeLanding({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Landing Invierno' }),
        ]),
    });
    setAdsService(service);
    setLandingService(landingService);
    render(<AdsSection />);

    await screen.findByText('Aún no hay campañas publicitarias.');
    const select = screen.getByLabelText('Landing de destino');
    expect(select).toBeInTheDocument();
    // Las opciones reales de landings se renderizan con su nombre visible.
    expect(screen.getByRole('option', { name: 'Landing Verano' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Landing Invierno' })).toBeInTheDocument();
    // La opción vacía está seleccionada por defecto.
    expect(select).toHaveValue('');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre'), 'Campaña sin landing');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear campaña' }));
    });

    // Al dejar la opción vacía, el payload envía landingId: undefined.
    expect(service.createAdCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ landingId: undefined }),
    );
  });

  it('degrada sin romperse cuando el servicio de landings no está registrado', async () => {
    const service = makeAdsService();
    setAdsService(service);
    // No se registra setLandingService: el selector debe renderizarse vacío sin crash.
    render(<AdsSection />);

    await screen.findByText('Aún no hay campañas publicitarias.');
    const select = screen.getByLabelText('Landing de destino');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('');
    expect(screen.queryByRole('option', { name: 'Landing Verano' })).not.toBeInTheDocument();
  });

  it('edita una campaña existente precargando el formulario', async () => {
    const landing = makeLanding({ name: 'Landing Verano' });
    const service = makeAdsService({
      listAdCampaigns: async () =>
        makePage([makeAdCampaign({ landing_id: landing.id })]),
      updateAdCampaign: vi.fn(async () => makeAdCampaign({ name: 'Verano 2026' })),
    });
    const landingService = makeLandingService({
      list: async () => makePage([landing]),
    });
    setAdsService(service);
    setLandingService(landingService);
    render(<AdsSection />);

    await screen.findByText('Casa vista al lago Tequesquitengo');
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    expect(screen.getByRole('form', { name: 'Editar campaña' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Casa vista al lago Tequesquitengo');
    expect(screen.getByLabelText('Estado')).toHaveValue('active');
    expect(screen.getByLabelText('Habilitada')).toBeChecked();
    expect(screen.getByLabelText('UTM Fuente')).toHaveValue('meta');
    expect(screen.getByLabelText('UTM Medio')).toHaveValue('cpc');
    expect(screen.getByLabelText('UTM Campaña')).toHaveValue('tequesquitengo-lago');
    expect(screen.getByLabelText('UTM Contenido')).toHaveValue('');
    expect(screen.getByLabelText('UTM Término')).toHaveValue('');
    expect(screen.getByLabelText('Landing de destino')).toHaveValue(landing.id);
    expect(screen.getByLabelText('Presupuesto (centavos)')).toHaveValue('');

    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Verano 2026');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    });

    expect(service.updateAdCampaign).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      name: 'Verano 2026',
      status: 'active',
      enabled: true,
      utmSource: 'meta',
      utmMedium: 'cpc',
      utmCampaign: 'tequesquitengo-lago',
      utmContent: undefined,
      utmTerm: undefined,
      landingId: landing.id,
      budgetMinor: undefined,
      startAt: undefined,
      endAt: undefined,
      notes: undefined,
    });
  });

  it('elimina una campaña y vuelve al estado vacío', async () => {
    const service = makeAdsService({
      listAdCampaigns: async () => makePage([makeAdCampaign()]),
    });
    setAdsService(service);
    render(<AdsSection />);

    await screen.findByText('Casa vista al lago Tequesquitengo');
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(service.deleteAdCampaign).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(await screen.findByText('Aún no hay campañas publicitarias.')).toBeInTheDocument();
  });

  it('muestra el error de carga de forma accesible', async () => {
    const service = makeAdsService({
      listAdCampaigns: async () => {
        throw 'x';
      },
    });
    setAdsService(service);
    render(<AdsSection />);

    expect(
      await screen.findByText('No se pudieron cargar las campañas publicitarias.'),
    ).toBeInTheDocument();
  });
});
