/**
 * Pruebas del store de captación publicitaria (C-1, eslabón ①) — campañas
 * publicitarias con atribución UTM.
 *
 * Contrato:
 * - Usa las factorías compartidas de `@/test/adsMocks` para construir DTOs y
 *   el servicio mock (`IAdsService`), evitando duplicación en cada prueba.
 * - El flujo se aísla por colección: el store mantiene estado de carga/error
 *   independiente, por lo que el `describe` verifica solo su propia colección.
 * - `afterEach` desregistra el servicio para que las pruebas siguientes empiecen
 *   sin dependencia (estado de error estable al no haber servicio registrado).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { setAdsService, useAdsStore } from '@/store/adsStore';
import type { IAdCampaignInput, IAdsService } from '@/services/adsService';
import { makeAdCampaign, makeAdsService, makePage } from '@/test/adsMocks';

describe('adsStore', () => {
  beforeEach(() => {
    useAdsStore.getState().reset();
  });

  afterEach(() => {
    useAdsStore.getState().reset();
    setAdsService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useAdsStore.getState();
    expect(state.adCampaigns).toEqual([]);
    expect(state.adCampaignsStatus).toBe('idle');
    expect(state.adCampaignsError).toBeNull();
  });

  describe('campañas publicitarias', () => {
    it('carga las campañas publicitarias del tenant', async () => {
      const listAdCampaigns = vi
        .fn<IAdsService['listAdCampaigns']>()
        .mockResolvedValue(makePage([makeAdCampaign()]));
      setAdsService(makeAdsService({ listAdCampaigns }));

      await useAdsStore.getState().listAdCampaigns();

      expect(listAdCampaigns).toHaveBeenCalledTimes(1);
      expect(useAdsStore.getState().adCampaigns).toEqual([makeAdCampaign()]);
      expect(useAdsStore.getState().adCampaignsStatus).toBe('success');
    });

    it('crea una campaña publicitaria y la agrega a la colección', async () => {
      const created = makeAdCampaign({ name: 'Nueva campaña publicitaria' });
      const createAdCampaign = vi.fn<IAdsService['createAdCampaign']>().mockResolvedValue(created);
      setAdsService(makeAdsService({ createAdCampaign }));

      const input: IAdCampaignInput = { name: 'Nueva campaña publicitaria' };
      await useAdsStore.getState().createAdCampaign(input);

      expect(createAdCampaign).toHaveBeenCalledWith(input);
      expect(useAdsStore.getState().adCampaigns).toEqual([created]);
    });

    it('actualiza una campaña publicitaria reemplazándola en la colección', async () => {
      const original = makeAdCampaign();
      useAdsStore.setState({ adCampaigns: [original] });
      const updated = makeAdCampaign({ status: 'paused' });
      const updateAdCampaign = vi.fn<IAdsService['updateAdCampaign']>().mockResolvedValue(updated);
      setAdsService(makeAdsService({ updateAdCampaign }));

      await useAdsStore.getState().updateAdCampaign(original.id, { status: 'paused' });

      expect(updateAdCampaign).toHaveBeenCalledWith(original.id, {
        status: 'paused',
      });
      expect(useAdsStore.getState().adCampaigns).toEqual([updated]);
    });

    it('elimina una campaña publicitaria y la quita de la colección', async () => {
      const toRemove = makeAdCampaign();
      useAdsStore.setState({
        adCampaigns: [toRemove, makeAdCampaign({ id: '99999999-9999-4999-8999-999999999999' })],
      });
      const deleteAdCampaign = vi
        .fn<IAdsService['deleteAdCampaign']>()
        .mockResolvedValue(undefined);
      setAdsService(makeAdsService({ deleteAdCampaign }));

      await useAdsStore.getState().deleteAdCampaign(toRemove.id);

      expect(deleteAdCampaign).toHaveBeenCalledWith(toRemove.id);
      expect(useAdsStore.getState().adCampaigns).toHaveLength(1);
    });

    it('degrade a error cuando falla la carga de campañas publicitarias', async () => {
      const listAdCampaigns = vi.fn<IAdsService['listAdCampaigns']>().mockRejectedValue('fallo');
      setAdsService(makeAdsService({ listAdCampaigns }));

      await useAdsStore.getState().listAdCampaigns();

      expect(useAdsStore.getState().adCampaignsStatus).toBe('error');
      expect(useAdsStore.getState().adCampaignsError).toBe(
        'No se pudieron cargar las campañas publicitarias.',
      );
    });

    it('propaga el mensaje de un AppError del servicio', async () => {
      const listAdCampaigns = vi.fn<IAdsService['listAdCampaigns']>().mockRejectedValue(
        new AppError('Fallo al listar campañas publicitarias', 'ads.campaigns.list', {
          status: 500,
        }),
      );
      setAdsService(makeAdsService({ listAdCampaigns }));

      await useAdsStore.getState().listAdCampaigns();

      expect(useAdsStore.getState().adCampaignsStatus).toBe('error');
      expect(useAdsStore.getState().adCampaignsError).toBe(
        'Fallo al listar campañas publicitarias',
      );
    });

    it('propaga el mensaje de un Error genérico del servicio', async () => {
      const listAdCampaigns = vi
        .fn<IAdsService['listAdCampaigns']>()
        .mockRejectedValue(new Error('Red caída'));
      setAdsService(makeAdsService({ listAdCampaigns }));

      await useAdsStore.getState().listAdCampaigns();

      expect(useAdsStore.getState().adCampaignsStatus).toBe('error');
      expect(useAdsStore.getState().adCampaignsError).toBe('Red caída');
    });

    it('degrade a error en campañas publicitarias sin servicio registrado', async () => {
      await useAdsStore.getState().createAdCampaign({ name: 'Sin servicio' });

      expect(useAdsStore.getState().adCampaignsStatus).toBe('error');
      expect(useAdsStore.getState().adCampaignsError).toBe(
        'La captación publicitaria no está disponible.',
      );
    });
  });

  it('reset descarta el estado y vuelve al inicial por defecto', () => {
    useAdsStore.setState({
      adCampaigns: [makeAdCampaign()],
      adCampaignsStatus: 'success',
      adCampaignsError: 'error residual',
    });

    useAdsStore.getState().reset();

    const state = useAdsStore.getState();
    expect(state.adCampaigns).toEqual([]);
    expect(state.adCampaignsStatus).toBe('idle');
    expect(state.adCampaignsError).toBeNull();
  });
});
