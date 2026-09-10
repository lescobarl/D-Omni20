import { act } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalLookSection } from '@/components/Settings/PortalLookSection';
import { setPortalLookService, usePortalUiStore } from '@/store/portalUiStore';
import { useAuthStore } from '@/store/authStore';
import { makeService } from '@/test/tenantConfigMocks';

describe('PortalLookSection', () => {
  beforeEach(() => {
    usePortalUiStore.setState({
      accent: 'brand',
      surface: 'light',
      status: 'idle',
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    setPortalLookService(null);
    useAuthStore.setState({ activeRole: null });
  });

  it('oculta el panel para roles distintos de admin', () => {
    useAuthStore.setState({ activeRole: 'configurador' });
    setPortalLookService(makeService());
    render(<PortalLookSection />);
    expect(screen.queryByText('Look & feel del portal de configuración')).not.toBeInTheDocument();
  });

  it('muestra el panel al admin y guarda el acento elegido', async () => {
    const user = userEvent.setup();
    const service = makeService();
    setPortalLookService(service);
    useAuthStore.setState({ activeRole: 'admin' });
    render(<PortalLookSection />);

    await screen.findByText('Look & feel del portal de configuración');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Neutro' }));
    });

    expect(service.savePortalLook).toHaveBeenCalledWith({
      portal_accent: 'neutral',
      portal_surface: 'light',
    });
  });

  it('hidrata el look del tenant al montar (solo admin)', async () => {
    const service = makeService({
      getPortalLook: vi
        .fn<ReturnType<typeof makeService>['getPortalLook']>()
        .mockResolvedValue({ portal_accent: 'neutral', portal_surface: 'tint' }),
    });
    setPortalLookService(service);
    useAuthStore.setState({ activeRole: 'admin' });
    render(<PortalLookSection />);

    await waitFor(() => {
      expect(usePortalUiStore.getState().accent).toBe('neutral');
    });
    expect(usePortalUiStore.getState().surface).toBe('tint');
  });
});
