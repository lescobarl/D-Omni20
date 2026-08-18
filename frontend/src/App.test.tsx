/**
 * Pruebas del componente raíz de la aplicación.
 *
 * Contrato:
 * - Renderiza la cabecera con la configuración inyectada.
 * - Agrega bloques desde la librería y los muestra en el canvas.
 */
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '@/App';
import { createTestConfig } from '@/test/config';
import { useEditorStore } from '@/store/editorStore';

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    useEditorStore.getState().reset();
  });

  it('renderiza el nombre de la aplicación y el tenant desde la configuración', () => {
    render(<App config={createTestConfig()} />);

    expect(screen.getByText('OmniBotIA Studio')).toBeInTheDocument();
    expect(screen.getByText('Tenant: test-tenant')).toBeInTheDocument();
    expect(screen.getByText('development')).toBeInTheDocument();
  });

  it('muestra el estado vacío del canvas cuando no hay bloques', () => {
    render(<App config={createTestConfig()} />);

    expect(
      screen.getByText('Selecciona un bloque de la librería para comenzar.'),
    ).toBeInTheDocument();
  });

  it('agrega un bloque desde la librería y lo muestra en el canvas', async () => {
    const user = userEvent.setup();
    render(<App config={createTestConfig()} />);

    // `act` explícito: el clic actualiza el store de Zustand y los suscriptores
    // (Canvas/CodeEditor) re-renderizan en un microtask posterior al act de
    // user-event, lo que dispararía "not wrapped in act(...)".
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Hero con Video/ }));
    });

    expect(screen.getByText('¡Impulsa tu negocio!')).toBeInTheDocument();
    expect(screen.getByText('Comprar ahora')).toBeInTheDocument();
  });
});
