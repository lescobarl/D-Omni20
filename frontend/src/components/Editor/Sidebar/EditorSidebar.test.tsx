/**
 * Pruebas de la barra lateral del editor con pestañas Bloques | IA.
 *
 * Contrato:
 * - La pestaña "IA" solo aparece cuando la bandera `features.aiAssistant` está activa.
 * - Implementa semántica de pestañas accesible (`tablist`/`tab`/`tabpanel`).
 * - Por defecto arranca en la pestaña de bloques.
 */
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorSidebar } from '@/components/Editor/Sidebar/EditorSidebar';
import { createTestConfig } from '@/test/config';
import { useAiStore } from '@/store/aiStore';
import { useAnalyticsStore } from '@/store/analyticsStore';
import { useEditorStore } from '@/store/editorStore';
import { useMarketplaceStore } from '@/store/marketplaceStore';

/** Configuración con la bandera del asistente IA activa. */
function configWithAi(): ReturnType<typeof createTestConfig> {
  return createTestConfig({
    features: { ...createTestConfig().features, aiAssistant: true },
  });
}

/** Configuración con la bandera del editor de schemas activa. */
function configWithDeveloper(): ReturnType<typeof createTestConfig> {
  return createTestConfig({
    features: { ...createTestConfig().features, developerSchemas: true },
  });
}

/** Configuración con la bandera del marketplace de templates activa. */
function configWithMarketplace(): ReturnType<typeof createTestConfig> {
  return createTestConfig({
    features: { ...createTestConfig().features, templateMarketplace: true },
  });
}

/** Configuración con la bandera de analítica avanzada activa. */
function configWithAnalytics(): ReturnType<typeof createTestConfig> {
  return createTestConfig({
    features: { ...createTestConfig().features, analytics: true },
  });
}

describe('EditorSidebar', () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
    useAiStore.getState().reset();
    useMarketplaceStore.getState().reset();
    useAnalyticsStore.getState().reset();
  });

  it('arranca en la pestaña de bloques por defecto', () => {
    render(<EditorSidebar config={createTestConfig()} />);

    expect(screen.getByRole('tablist', { name: 'Panel lateral del editor' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Bloques' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Bloques' })).not.toHaveAttribute('hidden');
  });

  it('oculta la pestaña IA cuando la bandera está desactivada', () => {
    render(<EditorSidebar config={createTestConfig()} />);

    expect(screen.queryByRole('tab', { name: 'IA' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: 'IA' })).not.toBeInTheDocument();
  });

  it('muestra la pestaña IA cuando la bandera está activa', () => {
    render(<EditorSidebar config={configWithAi()} />);

    expect(screen.getByRole('tab', { name: 'IA' })).toHaveAttribute('aria-selected', 'false');
  });

  it('cambia a la pestaña IA y muestra el panel del asistente', async () => {
    const user = userEvent.setup();
    render(<EditorSidebar config={configWithAi()} />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'IA' }));
    });

    expect(screen.getByRole('tab', { name: 'IA' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'IA' })).not.toHaveAttribute('hidden');
    expect(screen.getByRole('heading', { name: 'Asistente IA' })).toBeInTheDocument();
    // `hidden` saca el panel inactivo del árbol de accesibilidad: se consulta por id.
    expect(document.getElementById('sidebar-panel-blocks')).toHaveAttribute('hidden');
  });

  it('oculta la pestaña Schemas cuando la bandera está desactivada', () => {
    render(<EditorSidebar config={createTestConfig()} />);

    expect(screen.queryByRole('tab', { name: 'Schemas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: 'Schemas' })).not.toBeInTheDocument();
  });

  it('muestra la pestaña Schemas cuando la bandera está activa', () => {
    render(<EditorSidebar config={configWithDeveloper()} />);

    expect(screen.getByRole('tab', { name: 'Schemas' })).toHaveAttribute('aria-selected', 'false');
  });

  it('cambia a la pestaña Schemas y muestra el panel del editor', async () => {
    const user = userEvent.setup();
    render(<EditorSidebar config={configWithDeveloper()} />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Schemas' }));
    });

    expect(screen.getByRole('tab', { name: 'Schemas' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Schemas' })).not.toHaveAttribute('hidden');
    expect(screen.getByRole('heading', { name: 'Editor de Schemas' })).toBeInTheDocument();
  });

  it('oculta la pestaña Marketplace cuando la bandera está desactivada', () => {
    render(<EditorSidebar config={createTestConfig()} />);

    expect(screen.queryByRole('tab', { name: 'Marketplace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: 'Marketplace' })).not.toBeInTheDocument();
  });

  it('muestra la pestaña Marketplace cuando la bandera está activa', () => {
    render(<EditorSidebar config={configWithMarketplace()} />);

    expect(screen.getByRole('tab', { name: 'Marketplace' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('cambia a la pestaña Marketplace y muestra el panel del catálogo', async () => {
    const user = userEvent.setup();
    render(<EditorSidebar config={configWithMarketplace()} />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Marketplace' }));
    });

    expect(screen.getByRole('tab', { name: 'Marketplace' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel', { name: 'Marketplace' })).not.toHaveAttribute('hidden');
    expect(screen.getByRole('heading', { name: 'Marketplace' })).toBeInTheDocument();
  });

  it('oculta la pestaña Analítica cuando la bandera está desactivada', () => {
    render(<EditorSidebar config={createTestConfig()} />);

    expect(screen.queryByRole('tab', { name: 'Analítica' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: 'Analítica' })).not.toBeInTheDocument();
  });

  it('muestra la pestaña Analítica cuando la bandera está activa', () => {
    render(<EditorSidebar config={configWithAnalytics()} />);

    expect(screen.getByRole('tab', { name: 'Analítica' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('cambia a la pestaña Analítica y muestra el panel del dashboard', async () => {
    const user = userEvent.setup();
    render(<EditorSidebar config={configWithAnalytics()} />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Analítica' }));
    });

    expect(screen.getByRole('tab', { name: 'Analítica' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Analítica' })).not.toHaveAttribute('hidden');
    expect(screen.getByRole('heading', { name: 'Analítica' })).toBeInTheDocument();
  });
});
