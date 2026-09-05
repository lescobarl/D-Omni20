import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TenantConfigSettings } from '@/components/Settings/TenantConfigSettings';
import { setTenantConfigService, useTenantConfigStore } from '@/store/tenantConfigStore';
import { setBotService, useBotStore } from '@/store/botStore';
import { createTestConfig } from '@/test/config';
import { makeService } from '@/test/tenantConfigMocks';
import { makeService as makeBotService } from '@/test/botMocks';

describe('TenantConfigSettings', () => {
  beforeEach(() => {
    useTenantConfigStore.getState().reset();
    useBotStore.getState().reset();
    setBotService(makeBotService());
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    useTenantConfigStore.getState().reset();
    useBotStore.getState().reset();
    setTenantConfigService(null);
    setBotService(null);
    document.documentElement.removeAttribute('style');
  });

  it('renderiza las 5 pestañas con la apariencia activa por defecto', () => {
    setTenantConfigService(makeService());

    render(<TenantConfigSettings config={createTestConfig()} />);

    expect(screen.getByRole('tablist', { name: 'Configuración del bot' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Apariencia',
      'Contenido',
      'Catálogo',
      'Canales',
      'Bots',
    ]);
    expect(screen.getByRole('tab', { name: 'Apariencia' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('muestra el panel de apariencia y oculta los demás del árbol accesible', () => {
    setTenantConfigService(makeService());

    render(<TenantConfigSettings config={createTestConfig()} />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Apariencia / Branding' }),
    ).toBeInTheDocument();
    expect(document.getElementById('settings-panel-content')).toHaveAttribute('hidden');
    expect(document.getElementById('settings-panel-catalog')).toHaveAttribute('hidden');
    expect(document.getElementById('settings-panel-channels')).toHaveAttribute('hidden');
    expect(document.getElementById('settings-panel-bots')).toHaveAttribute('hidden');
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Contenido / Base de conocimientos' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Catálogo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Canales' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Bots' })).not.toBeInTheDocument();
  });

  it('cambia de pestaña y vincula la pestaña activa con su panel', async () => {
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<TenantConfigSettings config={createTestConfig()} />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Contenido' }));
    });

    expect(screen.getByRole('tab', { name: 'Contenido' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Apariencia' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Contenido / Base de conocimientos' }),
    ).toBeInTheDocument();
    expect(document.getElementById('settings-panel-appearance')).toHaveAttribute('hidden');
    expect(document.getElementById('settings-panel-content')).not.toHaveAttribute('hidden');

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Bots' }));
    });

    expect(screen.getByRole('tab', { name: 'Bots' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Contenido' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Bots' })).toBeInTheDocument();
    expect(document.getElementById('settings-panel-content')).toHaveAttribute('hidden');
    expect(document.getElementById('settings-panel-bots')).not.toHaveAttribute('hidden');
  });

  it('vincula cada pestaña con su panel mediante aria-controls y aria-labelledby', () => {
    setTenantConfigService(makeService());

    render(<TenantConfigSettings config={createTestConfig()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);

    for (const tab of tabs) {
      const tabId = tab.getAttribute('id');
      const panelId = tab.getAttribute('aria-controls');
      expect(tabId).toMatch(/^settings-tab-/);
      expect(panelId).toMatch(/^settings-panel-/);

      const panel = document.getElementById(panelId ?? '');
      expect(panel).not.toBeNull();
      expect(panel?.getAttribute('aria-labelledby')).toBe(tabId);
    }
  });

  it('expone un encabezado accesible en cada sección', () => {
    setTenantConfigService(makeService());

    render(<TenantConfigSettings config={createTestConfig()} />);

    expect(document.getElementById('appearance-heading')).not.toBeNull();
    expect(document.getElementById('content-heading')).not.toBeNull();
    expect(document.getElementById('catalog-heading')).not.toBeNull();
    expect(document.getElementById('channels-heading')).not.toBeNull();
    expect(document.getElementById('bots-heading')).not.toBeNull();
  });
});
