/**
 * Pruebas del Panel de Despliegue al CDN (Fase 10).
 *
 * Contrato:
 * - Lee el id de la landing en edición desde `useEditorStore` sin recibir props.
 * - Sin `landing.id` (landing local aún no persistida) el botón queda deshabilitado
 *   con una explicación accesible (`role="status"`).
 * - `deploy` ejecuta el despliegue vía `useCdnStore` y muestra la URL pública versionada.
 * - Expone los estados de carga y de error de forma accesible (`role="status"` / `role="alert"`).
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ICdnDeployResponse } from '@/api/types';
import { CdnDeploymentPanel } from '@/components/Editor/Preview/CdnDeploymentPanel';
import type { ICdnService } from '@/services/cdnService';
import { setCdnService, useCdnStore } from '@/store/cdnStore';
import { useEditorStore } from '@/store/editorStore';

const LANDING_ID = '11111111-1111-4111-8111-111111111111';

/** Construye una respuesta de despliegue con valores por defecto. */
function makeDeployment(overrides: Partial<ICdnDeployResponse> = {}): ICdnDeployResponse {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    landing_id: LANDING_ID,
    version: 1,
    url: `https://cdn.omnibotia.example/landings/${LANDING_ID}/v1`,
    status: 'deployed',
    deployed_at: '2026-08-19T00:00:00Z',
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** Construye un servicio falso que registra llamadas y devuelve valores dados. */
function makeService(overrides: Partial<ICdnService> = {}): ICdnService {
  return {
    deploy: vi.fn<ICdnService['deploy']>().mockResolvedValue(makeDeployment()),
    ...overrides,
  };
}

describe('CdnDeploymentPanel', () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
    useCdnStore.getState().reset();
    setCdnService(makeService());
  });

  afterEach(() => {
    // El reset corre con el componente aún montado (el cleanup de RTL se ejecuta
    // después, en orden LIFO). Se envuelve en `act` para que las actualizaciones
    // del store (status/despliegue tras los tests) no se filtren fuera de su ámbito
    // y disparen warnings de act().
    act(() => {
      useCdnStore.getState().reset();
    });
    setCdnService(null);
  });

  it('deshabilita el botón y explica el estado cuando la landing no tiene id', () => {
    useEditorStore.setState({
      landing: {
        ...useEditorStore.getState().landing,
        id: undefined,
      },
    });
    render(<CdnDeploymentPanel />);

    expect(screen.getByRole('heading', { name: 'Despliegue al CDN' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desplegar al CDN' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/aún no está persistida en el backend/);
  });

  it('despliega la landing y muestra la URL del CDN al completar', async () => {
    useEditorStore.setState({
      landing: {
        ...useEditorStore.getState().landing,
        id: LANDING_ID,
      },
    });
    const user = userEvent.setup();
    render(<CdnDeploymentPanel />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Desplegar al CDN' }));
    });
    await act(async () => {});

    expect(screen.getByRole('status')).toHaveTextContent('Desplegada la versión 1 (deployed).');
    const link = screen.getByRole('link', { name: 'Abrir URL del CDN' });
    expect(link).toHaveAttribute('href', makeDeployment().url);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('muestra el estado de carga mientras el despliegue está pendiente', async () => {
    let resolve!: (value: ICdnDeployResponse) => void;
    setCdnService(
      makeService({
        deploy: vi
          .fn<ICdnService['deploy']>()
          .mockImplementation(() => new Promise<ICdnDeployResponse>((res) => (resolve = res))),
      }),
    );
    useEditorStore.setState({
      landing: {
        ...useEditorStore.getState().landing,
        id: LANDING_ID,
      },
    });
    const user = userEvent.setup();
    render(<CdnDeploymentPanel />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Desplegar al CDN' }));
    });

    expect(screen.getByRole('status')).toHaveTextContent('Desplegando la landing al CDN…');

    await act(async () => {
      resolve(makeDeployment());
    });
    await act(async () => {});

    expect(screen.getByRole('status')).toHaveTextContent('Desplegada la versión 1 (deployed).');
  });

  it('muestra el error de despliegue de forma accesible', async () => {
    setCdnService(
      makeService({
        deploy: vi
          .fn<ICdnService['deploy']>()
          .mockRejectedValue(new Error('Servicio no disponible')),
      }),
    );
    useEditorStore.setState({
      landing: {
        ...useEditorStore.getState().landing,
        id: LANDING_ID,
      },
    });
    const user = userEvent.setup();
    render(<CdnDeploymentPanel />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Desplegar al CDN' }));
    });
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent('Servicio no disponible');
  });
});
