/**
 * Pruebas del servicio de rebranding por URL (Fase 5).
 *
 * Contrato:
 * - `proposalToTheme` traduce la propuesta del backend (snake_case) al tema del tenant
 *   (camelCase), conservando los valores del tema actual para campos no detectados.
 * - `BackendRebrandingService` delega en el cliente tipado, traduciendo los inputs de
 *   dominio al payload del backend y emitiendo trazas de log cuando hay logger.
 * - `createRebrandingService` es el punto de inyección (composition root).
 */
import { describe, expect, it, vi } from 'vitest';
import type { IAppearanceProposal, IRebrandingConfigRead } from '@/api/types';
import type { ILogger } from '@/lib/logger';
import {
  BackendRebrandingService,
  createRebrandingService,
  proposalToTheme,
} from '@/services/rebrandingService';
import { makeApiClientMock } from '@/test/apiClientMocks';
import type { IAppTheme } from '@/types/config';

/** Construye un tema del tenant con valores por defecto (IAppTheme). */
function makeTheme(overrides: Partial<IAppTheme> = {}): IAppTheme {
  return {
    primaryColor: '#10b981',
    accentColor: '#3b82f6',
    surfaceColor: '#ffffff',
    textColor: '#0f172a',
    brandBadge: '#0ea5e9',
    logoUrl: 'https://cdn.omnibotia.example/logo.png',
    fontFamily: 'Inter',
    ...overrides,
  };
}

/** Construye una propuesta de apariencia del backend (snake_case). */
function makeProposal(overrides: Partial<IAppearanceProposal> = {}): IAppearanceProposal {
  return {
    primary_color: '#0055AA',
    accent_color: '#FF6600',
    surface_color: '#F5F5F5',
    text_color: '#111111',
    brand_badge: '#FF6600',
    logo_url: 'https://brand.example.com/logo-brand.png',
    font_family: 'Open Sans',
    detected_fonts: ['Open Sans', 'Roboto'],
    ...overrides,
  };
}

/** Construye una configuración de rebranding leída del backend. */
function makeRebrandingConfig(
  overrides: Partial<IRebrandingConfigRead> = {},
): IRebrandingConfigRead {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenant_id: 'tenant-1',
    name: 'Marca',
    url: 'https://brand.example.com',
    extracted: { ...makeProposal() },
    version: 1,
    revision: 1,
    updated_at: '2026-08-19T00:00:00Z',
    deleted: false,
    created_at: '2026-08-19T00:00:00Z',
    applied_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

describe('proposalToTheme', () => {
  it('traduce la propuesta snake_case del backend al tema camelCase del dominio', () => {
    const theme = proposalToTheme(makeProposal(), makeTheme());

    expect(theme).toEqual({
      primaryColor: '#0055AA',
      accentColor: '#FF6600',
      surfaceColor: '#F5F5F5',
      textColor: '#111111',
      brandBadge: '#FF6600',
      logoUrl: 'https://brand.example.com/logo-brand.png',
      fontFamily: 'Open Sans',
    });
  });

  it('rellena con el tema actual los campos que la propuesta no detecta', () => {
    const proposal = makeProposal({
      primary_color: null,
      accent_color: null,
      surface_color: null,
      text_color: null,
      brand_badge: null,
      logo_url: null,
      font_family: null,
    });
    const fallback = makeTheme({ primaryColor: '#111827' });

    expect(proposalToTheme(proposal, fallback)).toEqual(fallback);
  });

  it('conserva los campos existentes cuando solo algunos faltan en la propuesta', () => {
    const proposal = makeProposal({ primary_color: '#00ff00', surface_color: null });
    const theme = proposalToTheme(proposal, makeTheme({ surfaceColor: '#fafafa' }));

    expect(theme.primaryColor).toBe('#00ff00');
    expect(theme.surfaceColor).toBe('#fafafa');
    expect(theme.accentColor).toBe('#FF6600');
  });
});

describe('BackendRebrandingService', () => {
  it('extrae los estilos de una URL delegando en el cliente', async () => {
    const apiClient = makeApiClientMock();
    apiClient.extractUrlStyles = vi.fn().mockResolvedValue(makeProposal());
    const service = new BackendRebrandingService(apiClient);

    const result = await service.extractUrlStyles('https://brand.example.com');

    expect(apiClient.extractUrlStyles).toHaveBeenCalledWith('https://brand.example.com');
    expect(result).toEqual(makeProposal());
  });

  it('lista las configuraciones de rebranding delegando en el cliente', async () => {
    const apiClient = makeApiClientMock();
    apiClient.listRebrandingConfigs = vi.fn().mockResolvedValue([makeRebrandingConfig()]);
    const service = new BackendRebrandingService(apiClient);

    const result = await service.listRebrandingConfigs();

    expect(apiClient.listRebrandingConfigs).toHaveBeenCalledWith();
    expect(result).toEqual([makeRebrandingConfig()]);
  });

  it('guarda una configuración traduciendo el input de dominio al payload del backend', async () => {
    const apiClient = makeApiClientMock();
    apiClient.createRebrandingConfig = vi.fn().mockResolvedValue(makeRebrandingConfig());
    const service = new BackendRebrandingService(apiClient);

    const result = await service.createRebrandingConfig({
      name: 'Marca',
      url: 'https://brand.example.com',
    });

    expect(apiClient.createRebrandingConfig).toHaveBeenCalledWith({
      name: 'Marca',
      url: 'https://brand.example.com',
    });
    expect(result).toEqual(makeRebrandingConfig());
  });

  it('elimina una configuración delegando en el cliente con su identificador', async () => {
    const apiClient = makeApiClientMock();
    apiClient.deleteRebrandingConfig = vi.fn().mockResolvedValue(undefined);
    const service = new BackendRebrandingService(apiClient);

    await service.deleteRebrandingConfig('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    expect(apiClient.deleteRebrandingConfig).toHaveBeenCalledWith(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  it('emite trazas de log cuando se inyecta un logger', async () => {
    const logger = { debug: vi.fn() } as unknown as ILogger;
    const apiClient = makeApiClientMock();
    apiClient.extractUrlStyles = vi.fn().mockResolvedValue(makeProposal());
    const service = new BackendRebrandingService(apiClient, logger);

    await service.extractUrlStyles('https://brand.example.com');

    expect(logger.debug).toHaveBeenCalledWith('rebranding.extractUrlStyles', {
      url: 'https://brand.example.com',
    });
  });
});

describe('createRebrandingService', () => {
  it('construye una implementación BackendRebrandingService desde el cliente', () => {
    const service = createRebrandingService(makeApiClientMock());

    expect(service).toBeInstanceOf(BackendRebrandingService);
  });
});
