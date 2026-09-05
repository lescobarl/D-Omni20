/**
 * Sección "Canales" del configurador del tenant.
 *
 * Contrato:
 * - Conexión/desconexión del canal de WhatsApp Cloud API del bot.
 * - Los secretos (`accessToken` y `webhookSecret`) son write-only: se envían al
 *   crear y nunca se devuelven en las lecturas, por lo que no se editan después.
 * - El estado habilitado se alterna con `updateChannel` y el canal se elimina con
 *   `deleteChannel`; no existe un formulario de edición de secretos.
 * - Sección autocontenida: carga los canales al montar.
 * - Los errores del store se reflejan en un `aria-live` accesible.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { ITenantChannelRead } from '@/api/types';
import type { ITenantChannelInput } from '@/services/tenantConfigService';
import { useTenantConfigStore } from '@/store/tenantConfigStore';

/** Estado del formulario de conexión de un canal. */
interface IChannelFormState {
  /** Número de teléfono del canal de WhatsApp. */
  phoneNumber: string;
  /** Identificador externo único por tipo de canal. */
  externalId: string;
  /** Identificador del número en la plataforma del proveedor. */
  phoneNumberId: string;
  /** Token de acceso de la API del proveedor. */
  accessToken: string;
  /** Secreto de verificación del webhook. */
  webhookSecret: string;
  /** Indica si el canal está habilitado. */
  enabled: boolean;
}

const EMPTY_FORM: IChannelFormState = {
  phoneNumber: '',
  externalId: '',
  phoneNumberId: '',
  accessToken: '',
  webhookSecret: '',
  enabled: true,
};

/** Valor visible de un campo opcional (null/undefined/vacío → "—"). */
function formatNullable(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === '') {
    return '—';
  }
  return value;
}

/**
 * Sección de canales del bot con conexión de WhatsApp y control de estado.
 *
 * @example
 * ```tsx
 * <ChannelsSection />
 * ```
 *
 * @returns El formulario de conexión y la lista de canales con su estado.
 */
export function ChannelsSection(): ReactElement {
  const channels = useTenantConfigStore((state) => state.channels);
  const channelsStatus = useTenantConfigStore((state) => state.channelsStatus);
  const channelsError = useTenantConfigStore((state) => state.channelsError);
  const listChannels = useTenantConfigStore((state) => state.listChannels);
  const createChannel = useTenantConfigStore((state) => state.createChannel);
  const updateChannel = useTenantConfigStore((state) => state.updateChannel);
  const deleteChannel = useTenantConfigStore((state) => state.deleteChannel);

  const [form, setForm] = useState<IChannelFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // Sección autocontenida: carga los canales al montar.
  useEffect(() => {
    void listChannels();
  }, [listChannels]);

  const setField = <K extends keyof IChannelFormState>(
    key: K,
    value: IChannelFormState[K],
  ): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  };

  const resetForm = (): void => {
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const phoneNumber = form.phoneNumber.trim();
    if (phoneNumber === '') {
      setFormError('El número de teléfono es obligatorio.');
      return;
    }
    const input: ITenantChannelInput = {
      phoneNumber,
      externalId: form.externalId.trim() === '' ? undefined : form.externalId,
      phoneNumberId: form.phoneNumberId.trim() === '' ? undefined : form.phoneNumberId,
      accessToken: form.accessToken.trim() === '' ? undefined : form.accessToken,
      webhookSecret: form.webhookSecret.trim() === '' ? undefined : form.webhookSecret,
      enabled: form.enabled,
    };
    await createChannel(input);
    resetForm();
  };

  const handleToggle = async (channel: ITenantChannelRead): Promise<void> => {
    await updateChannel(channel.id, { enabled: !channel.enabled });
  };

  const handleDelete = async (channel: ITenantChannelRead): Promise<void> => {
    await deleteChannel(channel.id);
  };

  const isLoading = channelsStatus === 'loading' && channels.length === 0;

  return (
    <section aria-labelledby="channels-heading">
      <h2 id="channels-heading" className="text-lg font-semibold text-slate-900">
        Canales
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Conecta el canal de WhatsApp Cloud API del bot. El token de acceso y el secreto del webhook
        se almacenan cifrados y nunca se muestran de nuevo (write-only).
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando canales…
        </p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4"
            aria-label="Conectar canal de WhatsApp"
          >
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">Conectar WhatsApp</legend>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="channel-phone" className="block text-sm text-slate-600">
                    Número de teléfono *
                  </label>
                  <input
                    id="channel-phone"
                    type="tel"
                    value={form.phoneNumber}
                    onChange={(event) => setField('phoneNumber', event.target.value)}
                    placeholder="5215512345678"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="channel-external-id" className="block text-sm text-slate-600">
                    Identificador externo
                  </label>
                  <input
                    id="channel-external-id"
                    type="text"
                    value={form.externalId}
                    onChange={(event) => setField('externalId', event.target.value)}
                    placeholder="Número de negocio en Meta"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="channel-phone-number-id" className="block text-sm text-slate-600">
                    ID del número de teléfono (Meta)
                  </label>
                  <input
                    id="channel-phone-number-id"
                    type="text"
                    value={form.phoneNumberId}
                    onChange={(event) => setField('phoneNumberId', event.target.value)}
                    placeholder="10293847561234567"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="channel-access-token" className="block text-sm text-slate-600">
                    Token de acceso
                  </label>
                  <input
                    id="channel-access-token"
                    type="password"
                    autoComplete="new-password"
                    value={form.accessToken}
                    onChange={(event) => setField('accessToken', event.target.value)}
                    placeholder="EAAG…"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="channel-webhook-secret" className="block text-sm text-slate-600">
                    Secreto del webhook
                  </label>
                  <input
                    id="channel-webhook-secret"
                    type="password"
                    autoComplete="new-password"
                    value={form.webhookSecret}
                    onChange={(event) => setField('webhookSecret', event.target.value)}
                    placeholder="Secreto de verificación"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="channel-enabled"
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => setField('enabled', event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  <label htmlFor="channel-enabled" className="text-sm text-slate-600">
                    Conectar habilitado
                  </label>
                </div>
              </div>
            </fieldset>

            <p className="text-xs text-slate-400">
              Los tokens y secretos son write-only: se almacenan cifrados y nunca se muestran de
              nuevo.
            </p>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={channelsStatus === 'loading'}
                className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Conectar canal
              </button>
              <span role="status" aria-live="polite" className="text-sm">
                {formError !== null && <span className="text-red-600">{formError}</span>}
              </span>
            </div>
          </form>

          <div>
            <p className="text-sm font-medium text-slate-700">Canales conectados</p>
            {channels.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no hay canales conectados.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {channels.map((channel) => (
                  <li key={channel.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                              channel.enabled
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {channel.enabled ? 'Conectado' : 'Desconectado'}
                          </span>
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
                            WhatsApp
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-sm font-semibold text-slate-900">
                          {channel.phone_number}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          ID externo: {formatNullable(channel.external_id)}
                        </p>
                        <p className="mt-0.5 text-sm text-slate-500">
                          ID de Meta: {formatNullable(channel.phone_number_id)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <button
                          type="button"
                          onClick={() => void handleToggle(channel)}
                          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                        >
                          {channel.enabled ? 'Desconectar' : 'Conectar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(channel)}
                          className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
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
        {channelsError !== null && <span className="text-red-600">{channelsError}</span>}
      </span>
    </section>
  );
}
