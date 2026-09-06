import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppearanceSection } from '@/components/Settings/AppearanceSection';
import {
  setRebrandingService,
  setTenantConfigService,
  useTenantConfigStore,
} from '@/store/tenantConfigStore';
import type { IRebrandingService } from '@/services/rebrandingService';
import { createTestConfig } from '@/test/config';
import {
  makeAppearanceProposal,
  makeRebrandingConfig,
  makeRebrandingService,
  makeService,
} from '@/test/tenantConfigMocks';

describe('AppearanceSection', () => {
  beforeEach(() => {
    useTenantConfigStore.getState().reset();
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    useTenantConfigStore.getState().reset();
    setTenantConfigService(null);
    setRebrandingService(null);
    document.documentElement.removeAttribute('style');
  });

  it('carga la apariencia del tenant y la muestra en el formulario', async () => {
    const service = makeService();
    setTenantConfigService(service);

    render(<AppearanceSection config={createTestConfig()} />);

    await screen.findByLabelText('Color primario');
    expect(service.getTenantAppearance).toHaveBeenCalledTimes(1);

    expect(screen.getByLabelText('Color primario')).toHaveValue('#10b981');
    expect(screen.getByLabelText('Color de acento')).toHaveValue('#3b82f6');
    expect(screen.getByLabelText('Color de superficie')).toHaveValue('#ffffff');
    expect(screen.getByLabelText('Color de texto')).toHaveValue('#0f172a');
    expect(screen.getByLabelText('Color de insignia')).toHaveValue('#0ea5e9');
    expect(screen.getByLabelText('URL del logo')).toHaveValue(
      'https://cdn.omnibotia.example/logo.png',
    );
    expect(screen.getByLabelText('Tipografía')).toHaveValue('Inter');
  });

  it('aplica un tema de marca predefinido a la paleta y a las variables CSS', async () => {
    const service = makeService();
    setTenantConfigService(service);

    render(<AppearanceSection config={createTestConfig()} />);

    await screen.findByLabelText('Color primario');
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Confianza' }));
    });

    // La paleta cambia al preset y la variable CSS se actualiza en vivo.
    expect(screen.getByLabelText('Color primario')).toHaveValue('#2563eb');
    expect(screen.getByLabelText('Color de acento')).toHaveValue('#0ea5e9');
    expect(screen.getByLabelText('Color de superficie')).toHaveValue('#f8fafc');
    expect(document.documentElement.style.getPropertyValue('--omni-brand-500')).toBe('37 99 235');
  });

  it('aplica el color editado en vivo como variable CSS y lo refleja en el código', async () => {
    const service = makeService();
    setTenantConfigService(service);

    render(<AppearanceSection config={createTestConfig()} />);

    await screen.findByLabelText('Color primario');
    fireEvent.change(screen.getByLabelText('Color primario'), {
      target: { value: '#ff0000' },
    });

    expect(document.documentElement.style.getPropertyValue('--omni-brand-500')).toBe('255 0 0');
    expect(screen.getByText('#ff0000')).toBeInTheDocument();
  });

  it('aplica la tipografía editada como variable CSS', async () => {
    const service = makeService();
    setTenantConfigService(service);

    render(<AppearanceSection config={createTestConfig()} />);

    await screen.findByLabelText('Tipografía');
    fireEvent.change(screen.getByLabelText('Tipografía'), { target: { value: 'Roboto' } });

    expect(document.documentElement.style.getPropertyValue('--omni-font-family')).toBe('Roboto');
  });

  it('deshabilita el guardado hasta que hay cambios y lo habilita tras editar', async () => {
    const service = makeService();
    setTenantConfigService(service);

    render(<AppearanceSection config={createTestConfig()} />);

    await screen.findByLabelText('Color primario');
    const saveButton = screen.getByRole('button', { name: 'Guardar apariencia' });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Color primario'), {
      target: { value: '#ff0000' },
    });
    expect(saveButton).toBeEnabled();
  });

  it('guarda la apariencia, confirma el guardado y conserva el borrador editado', async () => {
    const service = makeService();
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<AppearanceSection config={createTestConfig()} />);

    await screen.findByLabelText('Color primario');
    fireEvent.change(screen.getByLabelText('Color primario'), {
      target: { value: '#ff0000' },
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar apariencia' }));
    });

    expect(service.saveTenantAppearance).toHaveBeenCalledWith(
      expect.objectContaining({ primaryColor: '#ff0000' }),
    );
    expect(screen.getByText('Apariencia guardada.')).toBeInTheDocument();

    await act(async () => {});

    expect(screen.getByText('Apariencia guardada.')).toBeInTheDocument();
    expect(screen.getByLabelText('Color primario')).toHaveValue('#ff0000');
    expect(useTenantConfigStore.getState().appearance?.primaryColor).toBe('#10b981');
  });

  it('usa el tema por defecto cuando la apariencia aún no existe (404 → null)', async () => {
    const service = makeService({ getTenantAppearance: async () => null });
    setTenantConfigService(service);

    render(<AppearanceSection config={createTestConfig()} />);

    await screen.findByLabelText('Color primario');
    expect(screen.getByLabelText('Color de insignia')).toHaveValue('#10b981');
    expect(screen.getByLabelText('URL del logo')).toHaveValue('');
    expect(screen.getByLabelText('Tipografía')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Guardar apariencia' })).toBeDisabled();
  });

  it('muestra el error de carga de forma accesible', async () => {
    const service = makeService({
      getTenantAppearance: async () => {
        throw 'respuesta no estructurada';
      },
    });
    setTenantConfigService(service);

    render(<AppearanceSection config={createTestConfig()} />);

    expect(await screen.findByText('No se pudo cargar la apariencia.')).toBeInTheDocument();
  });

  it('oculta el subpanel de rebranding cuando el servicio no está registrado', async () => {
    setTenantConfigService(makeService());

    render(<AppearanceSection config={createTestConfig()} />);

    await screen.findByLabelText('Color primario');
    expect(screen.queryByText('Importar de URL (rebranding)')).not.toBeInTheDocument();
  });

  it('extrae una propuesta de estilos desde la URL de la marca y la muestra', async () => {
    const proposal = makeAppearanceProposal();
    const rebranding = makeRebrandingService({
      extractUrlStyles: vi.fn<IRebrandingService['extractUrlStyles']>().mockResolvedValue(proposal),
    });
    const user = userEvent.setup();
    setTenantConfigService(makeService());
    setRebrandingService(rebranding);

    render(<AppearanceSection config={createTestConfig()} />);

    await screen.findByLabelText('Color primario');
    fireEvent.change(screen.getByLabelText('URL de la marca'), {
      target: { value: 'https://brand.example.com' },
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Extraer estilos' }));
    });

    expect(rebranding.extractUrlStyles).toHaveBeenCalledWith('https://brand.example.com');
    expect(await screen.findByText('Propuesta detectada')).toBeInTheDocument();
    expect(screen.getByAltText('Logo de la marca detectada')).toHaveAttribute(
      'src',
      'https://brand.example.com/logo-brand.png',
    );
    expect(screen.getByText('Open Sans')).toBeInTheDocument();
    expect(screen.getByText('Roboto')).toBeInTheDocument();
  });

  it('aplica la propuesta detectada al tema y lo guarda', async () => {
    const proposal = makeAppearanceProposal();
    const appearanceService = makeService();
    const rebranding = makeRebrandingService({
      extractUrlStyles: vi.fn<IRebrandingService['extractUrlStyles']>().mockResolvedValue(proposal),
    });
    const user = userEvent.setup();
    setTenantConfigService(appearanceService);
    setRebrandingService(rebranding);

    render(<AppearanceSection config={createTestConfig()} />);

    await screen.findByLabelText('Color primario');
    fireEvent.change(screen.getByLabelText('URL de la marca'), {
      target: { value: 'https://brand.example.com' },
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Extraer estilos' }));
    });
    await screen.findByText('Propuesta detectada');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Aplicar al tema' }));
    });

    expect(appearanceService.saveTenantAppearance).toHaveBeenCalledWith(
      expect.objectContaining({ primaryColor: '#0055AA' }),
    );
    expect(screen.getByLabelText('Color primario')).toHaveValue('#0055aa');
  });

  it('guarda una configuración de rebranding y confirma el guardado', async () => {
    const rebranding = makeRebrandingService({
      createRebrandingConfig: vi
        .fn<IRebrandingService['createRebrandingConfig']>()
        .mockResolvedValue(makeRebrandingConfig({ name: 'Marca X' })),
    });
    const user = userEvent.setup();
    setTenantConfigService(makeService());
    setRebrandingService(rebranding);

    render(<AppearanceSection config={createTestConfig()} />);

    await screen.findByLabelText('Color primario');
    fireEvent.change(screen.getByLabelText('URL de la marca'), {
      target: { value: 'https://marca.ejemplo.com' },
    });
    fireEvent.change(screen.getByLabelText('Nombre de la configuración'), {
      target: { value: 'Marca X' },
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });

    expect(rebranding.createRebrandingConfig).toHaveBeenCalledWith({
      name: 'Marca X',
      url: 'https://marca.ejemplo.com',
    });
    expect(await screen.findByText('Configuración guardada.')).toBeInTheDocument();
  });

  it('elimina una configuración de rebranding guardada', async () => {
    const config = makeRebrandingConfig();
    const rebranding = makeRebrandingService({
      deleteRebrandingConfig: vi
        .fn<IRebrandingService['deleteRebrandingConfig']>()
        .mockResolvedValue(undefined),
    });
    const user = userEvent.setup();
    setTenantConfigService(makeService());
    setRebrandingService(rebranding);

    render(<AppearanceSection config={createTestConfig()} />);

    await screen.findByLabelText('Color primario');
    // El montaje carga las configuraciones guardadas (listRebrandingConfigs → [config]).
    expect(await screen.findByText(config.name)).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(rebranding.deleteRebrandingConfig).toHaveBeenCalledWith(config.id);
    expect(screen.queryByText(config.name)).not.toBeInTheDocument();
  });
});
