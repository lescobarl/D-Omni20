/**
 * Pruebas de la sección "Mantenimiento" del área de operación del bot (B.9).
 *
 * Contrato:
 * - Muestra su cabecera, su eslabón del ciclo comercial (`Operación continua`)
 *   y las cinco pestañas internas (Estado, Limpieza, Optimización,
 *   Configuración y Backup/Restaurar) en un tablist accesible.
 * - Carga la configuración de mantenimiento y el resumen operativo al montar
 *   (una sola llamada a `getMaintenanceConfig` y `getStatsOverview`).
 * - Estado renderiza los KPIs del resumen como tarjetas y permite recargarlos.
 * - Limpieza ejecuta `purgeMaintenance` y muestra su resultado; Optimización
 *   ejecuta `optimizeMaintenance` y muestra su duración. Cada pestaña filtra
 *   el resultado por `action` para no mostrar el de la otra acción.
 * - Configuración sincroniza el formulario con la configuración cargada y
 *   guarda con `upsertMaintenanceConfig` (entrada camelCase del servicio).
 * - Backup/Restaurar descarga el backup con `createBackup` y muestra sus
 *   metadatos, y restaura desde un archivo con `restoreBackup` mostrando el
 *   resultado.
 * - Sin servicio registrado o ante un error del store se muestra un estado
 *   vacío accesible con reintento y el mensaje en un `aria-live`.
 */
import { act } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MantenimientoBot } from '@/components/Operations/MantenimientoBot';
import { setOperationsService, useOperationsStore } from '@/store/operationsStore';
import {
  makeBackupMeta,
  makeMaintenanceAction,
  makeMaintenanceConfig,
  makeRestoreResult,
  makeScheduledRunResult,
  makeService,
  makeStatsOverview,
  makeTableStats,
} from '@/test/operationsMocks';
import { AppError } from '@/lib/errors';

describe('MantenimientoBot', () => {
  beforeEach(() => {
    useOperationsStore.getState().reset();
  });

  afterEach(() => {
    useOperationsStore.getState().reset();
    setOperationsService(null);
  });

  it('muestra la cabecera, su eslabón y las pestañas internas al cargar', async () => {
    const service = makeService();
    setOperationsService(service);

    render(<MantenimientoBot />);

    expect(screen.getByRole('heading', { name: 'Mantenimiento' })).toBeInTheDocument();
    expect(screen.getByText('Operación continua')).toBeInTheDocument();
    expect(service.getMaintenanceConfig).toHaveBeenCalledTimes(1);
    expect(service.getStatsOverview).toHaveBeenCalledTimes(1);

    const tablist = screen.getByRole('tablist', { name: 'Mantenimiento' });
    expect(within(tablist).getByRole('tab', { name: 'Estado' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(tablist).getByRole('tab', { name: 'Limpieza' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: 'Optimización' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: 'Configuración' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: 'Backup/Restaurar' })).toBeInTheDocument();
  });

  it('muestra los KPIs del estado como tarjetas', async () => {
    const service = makeService({
      getStatsOverview: async () =>
        makeStatsOverview({
          active_conversations: 3,
          inbound_messages: 2,
          outbound_messages: 1,
          total_messages: 3,
          escalated: 2,
          resolved: 1,
          unique_contacts: 2,
        }),
    });
    setOperationsService(service);

    render(<MantenimientoBot />);

    await screen.findByText('Conversaciones activas');
    expect(
      within(screen.getByTestId('metric-active_conversations')).getByText('3'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('metric-inbound_messages')).getByText('2'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('metric-outbound_messages')).getByText('1'),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('metric-total_messages')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByTestId('metric-escalated')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('metric-resolved')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('metric-unique_contacts')).getByText('2')).toBeInTheDocument();
  });

  it('recarga el estado al pulsar «Recargar estado»', async () => {
    const service = makeService();
    setOperationsService(service);
    const user = userEvent.setup();

    render(<MantenimientoBot />);

    await screen.findByText('Conversaciones activas');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Recargar estado' }));
    });

    expect(service.getStatsOverview).toHaveBeenCalledTimes(2);
  });

  it('ejecuta la purga en Limpieza y muestra su resultado', async () => {
    const service = makeService({
      purgeMaintenance: vi.fn(async () =>
        makeMaintenanceAction({ deleted_conversations: 2, deleted_messages: 4 }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<MantenimientoBot />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Limpieza' }));
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Ejecutar purga' }));
    });

    expect(service.purgeMaintenance).toHaveBeenCalledTimes(1);
    expect(service.purgeMaintenance).toHaveBeenCalledWith({ scope: 'conversations' });
    const result = screen.getByTestId('purge-result');
    expect(within(result).getByText('2')).toBeInTheDocument();
    expect(within(result).getByText('4')).toBeInTheDocument();
    expect(within(result).getByText(/Se eliminaron los datos expirados/)).toBeInTheDocument();
  });

  it('purga la base de conocimiento y muestra documentos y sinónimos eliminados', async () => {
    const service = makeService({
      purgeMaintenance: vi.fn(async () =>
        makeMaintenanceAction({
          action: 'purge_knowledge_base',
          deleted_documents: 3,
          deleted_synonyms: 1,
        }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<MantenimientoBot />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Limpieza' }));
    });

    await act(async () => {
      await user.selectOptions(screen.getByTestId('purge-scope'), 'knowledge_base');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Ejecutar purga' }));
    });

    expect(service.purgeMaintenance).toHaveBeenCalledWith({ scope: 'knowledge_base' });
    const result = screen.getByTestId('purge-result');
    expect(within(result).getByText('3')).toBeInTheDocument();
    expect(within(result).getByText('1')).toBeInTheDocument();
  });

  it('purga las configuraciones y muestra las eliminadas', async () => {
    const service = makeService({
      purgeMaintenance: vi.fn(async () =>
        makeMaintenanceAction({ action: 'purge_configurations', deleted_configs: 5 }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<MantenimientoBot />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Limpieza' }));
    });

    await act(async () => {
      await user.selectOptions(screen.getByTestId('purge-scope'), 'configurations');
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Ejecutar purga' }));
    });

    expect(service.purgeMaintenance).toHaveBeenCalledWith({ scope: 'configurations' });
    const result = screen.getByTestId('purge-result');
    expect(within(result).getByText('5')).toBeInTheDocument();
  });

  it('ejecuta la optimización y muestra su duración', async () => {
    const service = makeService({
      optimizeMaintenance: vi.fn(async () =>
        makeMaintenanceAction({ action: 'optimize', duration_ms: 8 }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<MantenimientoBot />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Optimización' }));
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Ejecutar optimización' }));
    });

    expect(service.optimizeMaintenance).toHaveBeenCalledTimes(1);
    const result = screen.getByTestId('optimize-result');
    expect(within(result).getByText('8 ms')).toBeInTheDocument();
    expect(within(result).getByText(/Se eliminaron los datos expirados/)).toBeInTheDocument();
  });

  it('filtra el resultado de la acción por pestaña', async () => {
    const service = makeService();
    setOperationsService(service);
    const user = userEvent.setup();

    render(<MantenimientoBot />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Limpieza' }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Ejecutar purga' }));
    });
    expect(screen.getByTestId('purge-result')).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Optimización' }));
    });
    expect(screen.queryByTestId('purge-result')).not.toBeInTheDocument();
    expect(screen.queryByTestId('optimize-result')).not.toBeInTheDocument();
  });

  it('guarda la configuración con la retención y programación locales', async () => {
    const service = makeService({
      getMaintenanceConfig: async () => makeMaintenanceConfig(),
      upsertMaintenanceConfig: vi.fn(async (_input) =>
        makeMaintenanceConfig({
          retention_rules: { conversations: 60 },
          maintenance_schedule: '0 4 * * *',
        }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<MantenimientoBot />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Configuración' }));
    });

    expect(await screen.findByDisplayValue('90')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0 3 * * *')).toBeInTheDocument();

    const retentionInput = screen.getByTestId('retention-days');
    const scheduleInput = screen.getByTestId('maintenance-schedule');
    await act(async () => {
      await user.clear(retentionInput);
      await user.type(retentionInput, '60');
      await user.clear(scheduleInput);
      await user.type(scheduleInput, '0 4 * * *');
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    });

    expect(service.upsertMaintenanceConfig).toHaveBeenCalledWith({
      retentionRules: { conversations: 60 },
      maintenanceSchedule: '0 4 * * *',
    });
  });

  it('descarga el backup y muestra sus metadatos', async () => {
    const service = makeService({
      createBackup: vi.fn(async () =>
        makeBackupMeta({ format: 'omnibotia-operations-backup', version: 1 }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<MantenimientoBot />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Backup/Restaurar' }));
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Descargar backup' }));
    });

    expect(service.createBackup).toHaveBeenCalledTimes(1);
    const result = screen.getByTestId('backup-result');
    expect(within(result).getByText('omnibotia-operations-backup')).toBeInTheDocument();
    expect(within(result).getByText('1')).toBeInTheDocument();
    expect(within(result).getByText(/Backup descargado correctamente/)).toBeInTheDocument();
  });

  it('restaura un backup desde un archivo y muestra el resultado', async () => {
    const service = makeService({
      restoreBackup: vi.fn(async () =>
        makeRestoreResult({
          restored: { contacts: 2, templates: 1 },
          message: 'Backup restaurado correctamente.',
        }),
      ),
    });
    setOperationsService(service);
    const user = userEvent.setup();

    render(<MantenimientoBot />);

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: 'Backup/Restaurar' }));
    });

    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    await act(async () => {
      await user.upload(screen.getByTestId('restore-file-input'), file);
    });

    expect(service.restoreBackup).toHaveBeenCalledTimes(1);
    expect(service.restoreBackup).toHaveBeenCalledWith(file);
    const result = screen.getByTestId('restore-result');
    expect(within(result).getByText('Backup restaurado correctamente.')).toBeInTheDocument();
    expect(within(result).getByText('contacts')).toBeInTheDocument();
    expect(within(result).getByText('2')).toBeInTheDocument();
    expect(within(result).getByText('templates')).toBeInTheDocument();
    expect(within(result).getByText('1')).toBeInTheDocument();
  });

  it('muestra el error del estado de forma accesible y permite reintentar', async () => {
    const service = makeService({
      getStatsOverview: async () => {
        throw new AppError('Fallo de resumen', 'operations.stats.overview', { status: 500 });
      },
    });
    setOperationsService(service);

    render(<MantenimientoBot />);

    expect(await screen.findByText('No se pudo cargar el estado del bot.')).toBeInTheDocument();
    expect(await screen.findByText('Fallo de resumen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('degrade a error cuando no hay servicio registrado', async () => {
    setOperationsService(null);

    render(<MantenimientoBot />);

    expect(await screen.findByText('No se pudo cargar el estado del bot.')).toBeInTheDocument();
    expect(await screen.findByText('La operación del bot no está disponible.')).toBeInTheDocument();
  });

  it('muestra las métricas por tabla del tenant en el estado y permite recargarlas', async () => {
    const service = makeService({
      getTableStats: vi.fn(async () => [
        makeTableStats({ table_name: 'bot_contacts', total: 10, active: 8, inactive: 2 }),
        makeTableStats({ table_name: 'bot_conversations', total: 5, active: 3, inactive: 2 }),
      ]),
    });
    setOperationsService(service);

    render(<MantenimientoBot />);

    expect(await screen.findByText('Métricas por tabla del tenant')).toBeInTheDocument();
    expect(service.getTableStats).toHaveBeenCalledTimes(1);

    const table = screen.getByTestId('table-stats');
    expect(within(table).getByText('Tabla')).toBeInTheDocument();
    expect(within(table).getByText('Total')).toBeInTheDocument();
    expect(within(table).getByText('Activos')).toBeInTheDocument();
    expect(within(table).getByText('Inactivos')).toBeInTheDocument();

    const contactsRow = screen.getByTestId('table-stats-bot_contacts');
    expect(within(contactsRow).getByText('bot_contacts')).toBeInTheDocument();
    expect(within(contactsRow).getByText('10')).toBeInTheDocument();
    expect(within(contactsRow).getByText('8')).toBeInTheDocument();
    expect(within(contactsRow).getByText('2')).toBeInTheDocument();

    const conversationsRow = screen.getByTestId('table-stats-bot_conversations');
    expect(within(conversationsRow).getByText('bot_conversations')).toBeInTheDocument();
    expect(within(conversationsRow).getByText('5')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Recargar tablas' }));
    expect(service.getTableStats).toHaveBeenCalledTimes(2);
  });

  it('ejecuta el mantenimiento programado manual y muestra el resultado de sus tareas', async () => {
    const service = makeService({
      runScheduledMaintenance: vi.fn(async () =>
        makeScheduledRunResult({
          message: 'Mantenimiento programado ejecutado.',
          duration_ms: 42,
          tasks: [
            {
              table: 'conversations',
              operation: 'purge',
              status: 'ok',
              executed_at: '2026-08-19T12:00:00Z',
              message: 'Purga completada.',
            },
            {
              table: 'bot_contacts',
              operation: 'optimize',
              status: 'error',
              executed_at: '2026-08-19T12:00:00Z',
              message: 'Optimización fallida.',
            },
          ],
        }),
      ),
    });
    setOperationsService(service);

    render(<MantenimientoBot />);

    await userEvent.click(screen.getByRole('tab', { name: 'Configuración' }));

    expect(screen.getByTestId('scheduled-run-card')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ejecutar mantenimiento programado' }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar mantenimiento programado' }));

    expect(service.runScheduledMaintenance).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('scheduled-run-result')).toBeInTheDocument();
    expect(screen.getByText('Mantenimiento programado ejecutado.')).toBeInTheDocument();
    expect(screen.getByText('Duración: 42 ms')).toBeInTheDocument();

    const purgeTask = screen.getByTestId('scheduled-task-conversations-purge');
    expect(within(purgeTask).getByText('conversations · purge')).toBeInTheDocument();
    expect(within(purgeTask).getByText('Purga completada.')).toBeInTheDocument();
    expect(within(purgeTask).getByText('ok')).toBeInTheDocument();

    const optimizeTask = screen.getByTestId('scheduled-task-bot_contacts-optimize');
    expect(within(optimizeTask).getByText('bot_contacts · optimize')).toBeInTheDocument();
    expect(within(optimizeTask).getByText('Optimización fallida.')).toBeInTheDocument();
    expect(within(optimizeTask).getByText('error')).toBeInTheDocument();
  });
});
