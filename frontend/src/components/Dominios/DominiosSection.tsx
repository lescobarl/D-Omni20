/**
 * Sección de dominios personalizados (PSEO hosts) del tenant.
 *
 * Permite registrar un dominio propio, verificar su propiedad por DNS (TXT
 * `_omni2-verify.{host}`) y activarlo para el serving público. Solo los hosts
 * con `status === 'active'` se sirven públicamente; los pendientes muestran las
 * instrucciones del registro TXT y el botón "Verificar".
 *
 * Consume el store `useHostsStore`, que depende del servicio `IPseoHostService`
 * inyectado desde la raíz de composición cuando la feature flag `hosts` está
 * habilitada.
 *
 * - Validación local del campo obligatorio (dominio).
 * - Errores accesibles con `aria-live` y estados de carga con `role="status"`.
 * - Sin modo edición: los dominios se registran, verifican o eliminan.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { IPseoHostRead } from '@/api/types';
import type { IPseoHostInput } from '@/services/hostsService';
import { useHostsStore } from '@/store/hostsStore';
import type { IAppConfig } from '@/types/config';

/**
 * Sección de dominios personalizados del tenant (PSEO hosts).
 *
 * Registra un dominio propio, verifica su propiedad por DNS (TXT
 * `_omni2-verify.{host}`) y lo activa para el serving público. Consume el
 * store `useHostsStore` (servicio `IPseoHostService` inyectado cuando la
 * feature flag `hosts` está habilitada).
 */
export function DominiosSection({ config }: { config: IAppConfig }): ReactElement {
  const hosts = useHostsStore((state) => state.hosts);
  const hostsStatus = useHostsStore((state) => state.hostsStatus);
  const hostsError = useHostsStore((state) => state.hostsError);
  const listPseoHosts = useHostsStore((state) => state.listPseoHosts);
  const requestPseoHost = useHostsStore((state) => state.requestPseoHost);
  const verifyPseoHost = useHostsStore((state) => state.verifyPseoHost);
  const deletePseoHost = useHostsStore((state) => state.deletePseoHost);

  const [host, setHost] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void listPseoHosts();
  }, [listPseoHosts]);

  const handleHostChange = (value: string): void => {
    setHost(value);
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (host.trim() === '') {
      setFormError('El dominio es obligatorio.');
      return;
    }
    const input: IPseoHostInput = { host: host.trim() };
    await requestPseoHost(input);
    setHost('');
  };

  const handleVerify = (hostItem: IPseoHostRead): void => {
    void verifyPseoHost(hostItem.id);
  };

  const handleDelete = (hostItem: IPseoHostRead): void => {
    void deletePseoHost(hostItem.id);
  };

  const isLoading = hostsStatus === 'loading' && hosts.length === 0;

  return (
    <section aria-labelledby="dominios-heading">
      <h2 id="dominios-heading" className="text-lg font-semibold text-slate-900">
        Dominios personalizados
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Registra tu propio dominio para servir tu portal público (PSEO).
      </p>
      <span className="mt-2 inline-block rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
        Verificación DNS
      </span>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando dominios personalizados…
        </p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4"
            aria-label="Solicitar dominio"
          >
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">Nuevo dominio</legend>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="pseohost-host" className="block text-sm text-slate-600">
                    Dominio
                  </label>
                  <input
                    id="pseohost-host"
                    type="text"
                    value={host}
                    onChange={(event) => handleHostChange(event.target.value)}
                    placeholder="portal.miempresa.com"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Apunta un registro A hacia la IP del servicio o un CNAME hacia{' '}
                    <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">
                      {config.clientSubdomainBase}
                    </code>
                    .
                  </p>
                </div>
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={hostsStatus === 'loading'}
                className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Solicitar dominio
              </button>
            </div>
            <span role="status" aria-live="polite" className="text-sm">
              {formError !== null && <span className="text-red-600">{formError}</span>}
            </span>
          </form>

          <div>
            <p className="text-sm font-medium text-slate-700">Dominios registrados</p>
            {hosts.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no hay dominios personalizados.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {hosts.map((hostItem) => (
                  <li key={hostItem.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-slate-900">{hostItem.host}</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {hostItem.status === 'active' ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              Activo
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                              Pendiente
                            </span>
                          )}
                        </div>
                        {hostItem.status === 'active' ? (
                          <p className="mt-2 text-sm text-slate-600">
                            {hostItem.verified_at !== null
                              ? `Verificado el ${new Date(hostItem.verified_at).toLocaleString()}.`
                              : 'Activo y sirviéndose públicamente.'}
                          </p>
                        ) : (
                          <div className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">
                            <p className="font-medium text-slate-700">Verificación DNS (TXT)</p>
                            <p className="mt-1">
                              Nombre:{' '}
                              <code className="rounded bg-slate-100 px-1 py-0.5">
                                _omni2-verify.{hostItem.host}
                              </code>
                            </p>
                            <p className="mt-1">
                              Valor:{' '}
                              <code className="rounded bg-slate-100 px-1 py-0.5">
                                {hostItem.verify_token ?? '—'}
                              </code>
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {hostItem.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleVerify(hostItem)}
                            className="rounded border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 transition hover:bg-brand-50"
                          >
                            Verificar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDelete(hostItem)}
                          className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <span role="status" aria-live="polite" className="text-sm">
        {hostsError !== null && <span className="text-red-600">{hostsError}</span>}
      </span>
    </section>
  );
}
