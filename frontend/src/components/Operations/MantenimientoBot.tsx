/**
 * Sección "Mantenimiento" del área de operación del bot (B.9 — operación continua).
 *
 * Contrato:
 * - Cinco pestañas internas accesibles: Estado, Limpieza, Optimización,
 *   Configuración y Backup/Restaurar (mismo patrón `role="tablist"`/`tab`/`tabpanel`
 *   que `OperationsArea`).
 * - Estado muestra los KPIs del resumen operativo del tenant (misma fuente
 *   `GET /operations/stats/overview` que el Dashboard B.1 y Estadísticas B.2).
 * - Limpieza ejecuta la purga de datos expirados del tenant (reutiliza el
 *   `BotPrivacyService.purge_expired` del backend, RLS tenant-scoped) y muestra
 *   el resultado de la acción.
 * - Optimización ejecuta la optimización física (VACUUM + REINDEX) del almacén
 *   del tenant y muestra su duración y resultado.
 * - Configuración edita las reglas de retención y la programación del
 *   mantenimiento (PUT idempotente contra `GET/PUT /operations/maintenance`).
 * - Backup/Restaurar descarga el backup de la configuración de operación del
 *   tenant (GET /operations/maintenance/backup) y restaura un backup desde un
 *   archivo (POST /operations/maintenance/restore) con confirmación y auditoría.
 * - El resultado de la última acción se filtra por `action` (`purge`/`optimize`)
 *   para que cada pestaña presente únicamente su propio resultado.
 * - Los errores del store se reflejan en un `aria-live` accesible y, si aún no
 *   hay datos, se ofrece un reintento explícito.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useOperationsStore } from '@/store/operationsStore';

/** Pestañas internas de la sección de mantenimiento (B.9). */
type MantenimientoSubTab = 'estado' | 'limpieza' | 'optimizacion' | 'configuracion' | 'backup';

/** Métrica del resumen operativo que se muestra como tarjeta en "Estado" (B.9). */
interface IEstadoMetric {
  /** Clave del dato en `IStatsOverviewRead`. */
  key:
    | 'active_conversations'
    | 'inbound_messages'
    | 'outbound_messages'
    | 'total_messages'
    | 'escalated'
    | 'resolved'
    | 'unique_contacts';
  /** Etiqueta legible en español. */
  label: string;
}

/** Definición de pestañas internas de mantenimiento en orden de presentación (B.9). */
const SUB_TABS: ReadonlyArray<{ id: MantenimientoSubTab; label: string; description: string }> = [
  {
    id: 'estado',
    label: 'Estado',
    description: 'KPIs del estado actual de las tablas del bot.',
  },
  {
    id: 'limpieza',
    label: 'Limpieza',
    description: 'Purga de datos expirados según la retención del tenant.',
  },
  {
    id: 'optimizacion',
    label: 'Optimización',
    description: 'Optimización física del almacén del tenant.',
  },
  {
    id: 'configuracion',
    label: 'Configuración',
    description: 'Reglas de retención y programación del mantenimiento.',
  },
  {
    id: 'backup',
    label: 'Backup/Restaurar',
    description: 'Descarga y restaura la configuración de operación del tenant.',
  },
];

/** Métricas de "Estado" en orden de presentación (B.9, resumen operativo B.1/B.2). */
const ESTADO_METRICS: ReadonlyArray<IEstadoMetric> = [
  { key: 'active_conversations', label: 'Conversaciones activas' },
  { key: 'inbound_messages', label: 'Mensajes entrantes' },
  { key: 'outbound_messages', label: 'Mensajes salientes' },
  { key: 'total_messages', label: 'Mensajes totales' },
  { key: 'escalated', label: 'Escalados a humano' },
  { key: 'resolved', label: 'Resueltos por el bot' },
  { key: 'unique_contacts', label: 'Contactos únicos' },
];

/** Formatea un valor numérico con separadores de miles del locale `es-MX`. */
function formatNumber(value: number): string {
  return value.toLocaleString('es-MX');
}

/**
 * Sección de mantenimiento del bot (B.9).
 *
 * @example
 * ```tsx
 * <MantenimientoBot />
 * ```
 *
 * @returns Las cuatro pestañas internas de mantenimiento y sus paneles.
 */
export function MantenimientoBot(): ReactElement {
  const [subTab, setSubTab] = useState<MantenimientoSubTab>('estado');

  const maintenanceConfig = useOperationsStore((state) => state.maintenanceConfig);
  const maintenanceStatus = useOperationsStore((state) => state.maintenanceStatus);
  const maintenanceError = useOperationsStore((state) => state.maintenanceError);
  const loadMaintenanceConfig = useOperationsStore((state) => state.loadMaintenanceConfig);
  const upsertMaintenanceConfig = useOperationsStore((state) => state.upsertMaintenanceConfig);

  const statsOverview = useOperationsStore((state) => state.statsOverview);
  const statsOverviewStatus = useOperationsStore((state) => state.statsOverviewStatus);
  const statsOverviewError = useOperationsStore((state) => state.statsOverviewError);
  const loadStatsOverview = useOperationsStore((state) => state.loadStatsOverview);

  const maintenanceAction = useOperationsStore((state) => state.maintenanceAction);
  const maintenanceActionStatus = useOperationsStore((state) => state.maintenanceActionStatus);
  const maintenanceActionError = useOperationsStore((state) => state.maintenanceActionError);
  const purgeMaintenance = useOperationsStore((state) => state.purgeMaintenance);
  const optimizeMaintenance = useOperationsStore((state) => state.optimizeMaintenance);

  const backupMeta = useOperationsStore((state) => state.backupMeta);
  const backupStatus = useOperationsStore((state) => state.backupStatus);
  const backupError = useOperationsStore((state) => state.backupError);
  const createBackup = useOperationsStore((state) => state.createBackup);
  const restoreResult = useOperationsStore((state) => state.restoreResult);
  const restoreStatus = useOperationsStore((state) => state.restoreStatus);
  const restoreError = useOperationsStore((state) => state.restoreError);
  const restoreBackup = useOperationsStore((state) => state.restoreBackup);

  const tableStats = useOperationsStore((state) => state.tableStats);
  const tableStatsStatus = useOperationsStore((state) => state.tableStatsStatus);
  const tableStatsError = useOperationsStore((state) => state.tableStatsError);
  const loadTableStats = useOperationsStore((state) => state.loadTableStats);

  const scheduledRunResult = useOperationsStore((state) => state.scheduledRunResult);
  const scheduledRunStatus = useOperationsStore((state) => state.scheduledRunStatus);
  const scheduledRunError = useOperationsStore((state) => state.scheduledRunError);
  const runScheduledMaintenance = useOperationsStore((state) => state.runScheduledMaintenance);

  // Formulario local de configuración (se sincroniza cuando la config se materializa).
  const [retentionDays, setRetentionDays] = useState<string>('');
  const [schedule, setSchedule] = useState<string>('');

  // Dominio seleccionado para la purga (B.9 — Limpieza por dominio).
  const [purgeScope, setPurgeScope] = useState<'conversations' | 'knowledge_base' | 'configurations'>(
    'conversations',
  );

  // Sección autocontenida: carga la configuración, el resumen operativo y las
  // métricas por tabla al montar (B.9).
  useEffect(() => {
    void loadMaintenanceConfig();
    void loadStatsOverview();
    void loadTableStats();
  }, [loadMaintenanceConfig, loadStatsOverview, loadTableStats]);

  // Sincroniza el formulario local cuando la configuración se carga (404 → vacío).
  useEffect(() => {
    if (maintenanceConfig === null) {
      return;
    }
    const conversations = maintenanceConfig.retention_rules.conversations;
    setRetentionDays(typeof conversations === 'number' ? String(conversations) : '');
    setSchedule(maintenanceConfig.maintenance_schedule ?? '');
  }, [maintenanceConfig]);

  const isEstadoLoading = statsOverviewStatus === 'loading' && statsOverview === null;
  const hasEstado = statsOverview !== null;
  const isConfigLoading = maintenanceStatus === 'loading' && maintenanceConfig === null;

  /** Guarda la configuración de mantenimiento con la retención y programación locales. */
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void upsertMaintenanceConfig({
      retentionRules: { conversations: Number(retentionDays) },
      maintenanceSchedule: schedule,
    });
  };

  /** Descarga el backup de la configuración de operación del tenant (B.9). */
  const handleDownloadBackup = (): void => {
    void createBackup();
  };

  /** Restaura un backup desde el archivo seleccionado (B.9). */
  const handleRestoreFile = (file: File | null): void => {
    if (file === null) {
      return;
    }
    void restoreBackup(file);
  };

  const subTabButtonClass = (selected: boolean): string =>
    `flex-1 border-b-2 px-3 py-2 text-sm font-medium transition ${
      selected
        ? 'border-brand-600 text-brand-700'
        : 'border-transparent text-slate-500 hover:text-slate-700'
    }`;

  return (
    <section aria-labelledby="maintenance-heading">
      <h2 id="maintenance-heading" className="text-lg font-semibold text-slate-900">
        Mantenimiento
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Retención de datos y mantenimiento programado del bot. Estado de las tablas, limpieza de
        expirados y optimización del almacén del tenant.
      </p>
      <span className="mt-2 inline-block rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
        Operación continua
      </span>

      <div
        role="tablist"
        aria-label="Mantenimiento"
        className="mt-4 flex border-b border-slate-200"
      >
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`maintenance-subtab-${tab.id}`}
            aria-controls={`maintenance-panel-${tab.id}`}
            aria-selected={subTab === tab.id}
            onClick={() => setSubTab(tab.id)}
            className={subTabButtonClass(subTab === tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`maintenance-panel-${subTab}`}
        aria-labelledby={`maintenance-subtab-${subTab}`}
        className="mt-4"
      >
        {subTab === 'estado' ? (
          <div>
            {isEstadoLoading ? (
              <p className="mt-4 text-sm text-slate-500" role="status">
                Cargando el estado del bot…
              </p>
            ) : hasEstado ? (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-500">
                    Resumen del periodo actual de las tablas de conversación y mensajería.
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadStatsOverview()}
                    disabled={statsOverviewStatus === 'loading'}
                    className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Recargar estado
                  </button>
                </div>

                <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {ESTADO_METRICS.map((metric) => (
                    <div
                      key={metric.key}
                      data-testid={`metric-${metric.key}`}
                      className="rounded-lg border border-slate-200 bg-white p-4"
                    >
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {metric.label}
                      </dt>
                      <dd className="mt-1 text-2xl font-semibold text-slate-900">
                        {formatNumber(statsOverview[metric.key])}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-6">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Métricas por tabla del tenant
                    </h3>
                    <button
                      type="button"
                      onClick={() => void loadTableStats()}
                      disabled={tableStatsStatus === 'loading'}
                      className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Recargar tablas
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    Conteo total, activo e inactivo (borrado lógico) de cada tabla de operación del
                    tenant. Útil para detectar acumulación de datos inactivos.
                  </p>

                  {tableStatsStatus === 'loading' && tableStats.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500" role="status">
                      Cargando métricas por tabla…
                    </p>
                  ) : tableStats.length > 0 ? (
                    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                      <table
                        data-testid="table-stats"
                        className="min-w-full divide-y divide-slate-200 text-sm"
                      >
                        <thead className="bg-slate-50">
                          <tr>
                            <th
                              scope="col"
                              className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
                            >
                              Tabla
                            </th>
                            <th
                              scope="col"
                              className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500"
                            >
                              Total
                            </th>
                            <th
                              scope="col"
                              className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500"
                            >
                              Activos
                            </th>
                            <th
                              scope="col"
                              className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500"
                            >
                              Inactivos
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {tableStats.map((row) => (
                            <tr key={row.table_name} data-testid={`table-stats-${row.table_name}`}>
                              <td className="px-4 py-2 font-medium text-slate-900">
                                {row.table_name}
                              </td>
                              <td className="px-4 py-2 text-right text-slate-700">
                                {formatNumber(row.total)}
                              </td>
                              <td className="px-4 py-2 text-right text-slate-700">
                                {formatNumber(row.active)}
                              </td>
                              <td className="px-4 py-2 text-right text-slate-700">
                                {formatNumber(row.inactive)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-500" role="status">
                      No hay métricas por tabla disponibles.
                    </p>
                  )}

                  <span role="status" aria-live="polite" className="text-sm">
                    {tableStatsError !== null && (
                      <span className="text-red-600">{tableStatsError}</span>
                    )}
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <p className="text-sm text-slate-500" role="status">
                  No se pudo cargar el estado del bot.
                </p>
                <button
                  type="button"
                  onClick={() => void loadStatsOverview()}
                  className="mt-3 rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Reintentar
                </button>
              </div>
            )}

            <span role="status" aria-live="polite" className="text-sm">
              {statsOverviewError !== null && (
                <span className="text-red-600">{statsOverviewError}</span>
              )}
            </span>
          </div>
        ) : subTab === 'limpieza' ? (
          <div>
            <div
              data-testid="purge-card"
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold text-slate-900">Limpieza de datos expirados</h3>
              <p className="mt-1 text-sm text-slate-500">
                Elimina los datos vencidos del dominio seleccionado según la política de retención
                del tenant. La acción solo afecta los datos del tenant actual.
              </p>

              <label className="mt-3 block">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Dominio a purgar
                </span>
                <select
                  data-testid="purge-scope"
                  value={purgeScope}
                  onChange={(event) =>
                    setPurgeScope(event.target.value as 'conversations' | 'knowledge_base' | 'configurations')
                  }
                  disabled={maintenanceActionStatus === 'loading'}
                  className="mt-1 block w-full max-w-xs rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="conversations">Conversaciones y mensajes</option>
                  <option value="knowledge_base">Base de conocimiento (documentos y sinónimos)</option>
                  <option value="configurations">Configuraciones (rebranding y mantenimiento)</option>
                </select>
              </label>

              <button
                type="button"
                onClick={() => void purgeMaintenance({ scope: purgeScope })}
                disabled={maintenanceActionStatus === 'loading'}
                className="mt-3 rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {maintenanceActionStatus === 'loading' ? 'Purgando…' : 'Ejecutar purga'}
              </button>

              {maintenanceAction !== null &&
              (maintenanceAction.action === 'purge' ||
                maintenanceAction.action === 'purge_knowledge_base' ||
                maintenanceAction.action === 'purge_configurations') ? (
                <div
                  data-testid="purge-result"
                  className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {maintenanceAction.action === 'purge' ? (
                      <>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Conversaciones eliminadas
                          </dt>
                          <dd className="mt-1 text-xl font-semibold text-slate-900">
                            {maintenanceAction.deleted_conversations}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Mensajes eliminados
                          </dt>
                          <dd className="mt-1 text-xl font-semibold text-slate-900">
                            {maintenanceAction.deleted_messages}
                          </dd>
                        </div>
                      </>
                    ) : null}
                    {maintenanceAction.action === 'purge_knowledge_base' ? (
                      <>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Documentos eliminados
                          </dt>
                          <dd className="mt-1 text-xl font-semibold text-slate-900">
                            {maintenanceAction.deleted_documents}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Sinónimos eliminados
                          </dt>
                          <dd className="mt-1 text-xl font-semibold text-slate-900">
                            {maintenanceAction.deleted_synonyms}
                          </dd>
                        </div>
                      </>
                    ) : null}
                    {maintenanceAction.action === 'purge_configurations' ? (
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Configuraciones eliminadas
                        </dt>
                        <dd className="mt-1 text-xl font-semibold text-slate-900">
                          {maintenanceAction.deleted_configs}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <p className="mt-3 text-sm text-slate-600">{maintenanceAction.message}</p>
                </div>
              ) : null}
            </div>

            <span role="status" aria-live="polite" className="text-sm">
              {maintenanceActionError !== null && (
                <span className="text-red-600">{maintenanceActionError}</span>
              )}
            </span>
          </div>
        ) : subTab === 'optimizacion' ? (
          <div>
            <div
              data-testid="optimize-card"
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold text-slate-900">Optimización del almacén</h3>
              <p className="mt-1 text-sm text-slate-500">
                Reorganiza físicamente las tablas del bot (VACUUM + REINDEX) para recuperar espacio
                y mejorar el rendimiento de las consultas.
              </p>
              <button
                type="button"
                onClick={() => void optimizeMaintenance()}
                disabled={maintenanceActionStatus === 'loading'}
                className="mt-3 rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {maintenanceActionStatus === 'loading' ? 'Optimizando…' : 'Ejecutar optimización'}
              </button>

              {maintenanceAction !== null && maintenanceAction.action === 'optimize' ? (
                <div
                  data-testid="optimize-result"
                  className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <dl className="grid gap-3 sm:grid-cols-1">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Duración
                      </dt>
                      <dd className="mt-1 text-xl font-semibold text-slate-900">
                        {maintenanceAction.duration_ms} ms
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-sm text-slate-600">{maintenanceAction.message}</p>
                </div>
              ) : null}
            </div>

            <span role="status" aria-live="polite" className="text-sm">
              {maintenanceActionError !== null && (
                <span className="text-red-600">{maintenanceActionError}</span>
              )}
            </span>
          </div>
        ) : subTab === 'backup' ? (
          <div>
            <div
              data-testid="backup-card"
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold text-slate-900">
                Backup y restauración de la configuración
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Descarga una copia de seguridad de la configuración de operación del tenant o
                restaura una copia previa desde un archivo. La restauración reemplaza los datos
                actuales del tenant en una única transacción.
              </p>

              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  disabled={backupStatus === 'loading'}
                  className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {backupStatus === 'loading' ? 'Descargando…' : 'Descargar backup'}
                </button>

                <label className="inline-flex cursor-pointer items-center rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100">
                  {restoreStatus === 'loading' ? 'Restaurando…' : 'Restaurar backup'}
                  <input
                    type="file"
                    accept=".json,application/json"
                    data-testid="restore-file-input"
                    className="sr-only"
                    disabled={restoreStatus === 'loading'}
                    onChange={(event) => {
                      handleRestoreFile(event.target.files?.[0] ?? null);
                      event.target.value = '';
                    }}
                  />
                </label>
              </div>

              {backupMeta !== null ? (
                <div
                  data-testid="backup-result"
                  className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Formato
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-900">
                        {backupMeta.format}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Versión
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-900">
                        {backupMeta.version}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Creado
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-900">
                        {new Date(backupMeta.created_at).toLocaleString('es-MX')}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-sm text-slate-600">
                    Backup descargado correctamente. Guarda el archivo en un lugar seguro.
                  </p>
                </div>
              ) : null}

              {restoreResult !== null ? (
                <div
                  data-testid="restore-result"
                  className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <p className="text-sm font-semibold text-slate-900">{restoreResult.message}</p>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    {Object.entries(restoreResult.restored).map(([table, count]) => (
                      <div key={table}>
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          {table}
                        </dt>
                        <dd className="mt-1 text-sm font-semibold text-slate-900">{count}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </div>

            <span role="status" aria-live="polite" className="text-sm">
              {backupError !== null && <span className="text-red-600">{backupError}</span>}
              {restoreError !== null && <span className="text-red-600">{restoreError}</span>}
            </span>
          </div>
        ) : (
          <div>
            {isConfigLoading ? (
              <p className="mt-4 text-sm text-slate-500" role="status">
                Cargando configuración…
              </p>
            ) : (
              <form
                onSubmit={handleSubmit}
                data-testid="maintenance-form"
                className="mt-4 max-w-xl space-y-4"
              >
                <div>
                  <label
                    htmlFor="retention-days"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Días de retención de conversaciones
                  </label>
                  <input
                    id="retention-days"
                    name="retention-days"
                    type="number"
                    min={0}
                    value={retentionDays}
                    onChange={(event) => setRetentionDays(event.target.value)}
                    data-testid="retention-days"
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Los datos más antiguos que este límite se purgan automáticamente.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="maintenance-schedule"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Programación del mantenimiento
                  </label>
                  <input
                    id="maintenance-schedule"
                    name="maintenance-schedule"
                    type="text"
                    value={schedule}
                    onChange={(event) => setSchedule(event.target.value)}
                    placeholder="0 3 * * *"
                    data-testid="maintenance-schedule"
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Expresión cron de cinco campos (minuto, hora, día, mes, día de semana).
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={maintenanceStatus === 'loading'}
                  className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {maintenanceStatus === 'loading' ? 'Guardando…' : 'Guardar configuración'}
                </button>
              </form>
            )}

            <div
              data-testid="scheduled-run-card"
              className="mt-6 rounded-lg border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold text-slate-900">
                Ejecutar mantenimiento programado
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Ejecuta ahora, de forma manual, todas las tareas configuradas en la programación del
                mantenimiento (purga de expirados, optimización y backup) en un único lote.
              </p>
              <button
                type="button"
                onClick={() => void runScheduledMaintenance()}
                disabled={scheduledRunStatus === 'loading'}
                className="mt-3 rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {scheduledRunStatus === 'loading'
                  ? 'Ejecutando…'
                  : 'Ejecutar mantenimiento programado'}
              </button>

              {scheduledRunResult !== null ? (
                <div
                  data-testid="scheduled-run-result"
                  className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <p className="text-sm font-semibold text-slate-900">
                    {scheduledRunResult.message}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Duración: {scheduledRunResult.duration_ms} ms
                  </p>
                  <ul className="mt-3 space-y-2">
                    {scheduledRunResult.tasks.map((task) => (
                      <li
                        key={`${task.table}-${task.operation}`}
                        data-testid={`scheduled-task-${task.table}-${task.operation}`}
                        className="flex items-start justify-between gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <div>
                          <span className="font-medium text-slate-900">
                            {task.table} · {task.operation}
                          </span>
                          <p className="text-xs text-slate-500">{task.message}</p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                            task.status === 'ok'
                              ? 'bg-green-100 text-green-700'
                              : task.status === 'error'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {task.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <span role="status" aria-live="polite" className="text-sm">
                {scheduledRunError !== null && (
                  <span className="text-red-600">{scheduledRunError}</span>
                )}
              </span>
            </div>

            <span role="status" aria-live="polite" className="text-sm">
              {maintenanceError !== null && (
                <span className="text-red-600">{maintenanceError}</span>
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
