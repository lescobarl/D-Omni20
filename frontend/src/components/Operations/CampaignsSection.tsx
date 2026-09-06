/**
 * Sección "Campañas" del área de operación del bot (B.4/C-2 — eslabones ① Captación,
 * ⑦ Recuperación, ⑨ Recompra).
 *
 * Contrato:
 * - CRUD de `campaigns` del tenant (nombre, plantilla, estado y programación)
 *   gestionado por el backend con RLS.
 * - Sección autocontenida: carga las campañas al montar y reutiliza un único
 *   formulario para crear y editar campañas (modo edición).
 * - El nombre se valida localmente (obligatorio) antes de enviar.
 * - El estado se elige en un `select` con los estados estándar del ciclo de vida
 *   (draft, scheduled, sending, sent, cancelled) y se muestra como etiqueta.
 * - La programación es un texto ISO 8601 opcional.
 * - Segmentación (C-2): todas las audiencias, por etiquetas de contacto (con
 *   modo de coincidencia any/all) o por evento.
 * - Disparo (C-2): agendado o por evento de workflow (checkout.created,
 *   payment.completed).
 * - Los errores del store se reflejan en un `aria-live` accesible.
 */
import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import type {
  ICampaignRead,
  ICampaignRecipientRead,
  IIndividualSendInput,
  ILandingRead,
  ITemplateRead,
} from '@/api/types';
import type {
  ICampaignInput,
  ICampaignRecipientInput,
  ICsvImportInput,
  IRecipientFileInput,
} from '@/services/operationsService';
import { useOperationsStore } from '@/store/operationsStore';
import { getLandingService } from '@/store/editorStore';
import type { IAppConfig } from '@/types/config';

/** Estado del formulario de campañas (C-2: segmentación y disparo incluidas). */
interface ICampaignFormState {
  /** Nombre de la campaña (obligatorio, único por tenant). */
  name: string;
  /** ID de la plantilla de mensaje de la campaña (opcional). */
  templateId: string;
  /** Estado del ciclo de vida de la campaña. */
  state: string;
  /** Programación de envío en ISO 8601 (opcional). */
  schedule: string;
  /** Tipo de segmentación (C-2): '', 'tags' o 'event'. */
  segmentType: string;
  /** Etiquetas de contacto separadas por coma (C-2, solo segmentación tags). */
  segmentTags: string;
  /** Modo de coincidencia de etiquetas (C-2): 'any' o 'all'. */
  segmentMatch: string;
  /** Tipo de disparo (C-2): '', 'scheduled' o 'event'. */
  triggerType: string;
  /** Evento de workflow que dispara la campaña (C-2, solo disparo event). */
  triggerEvent: string;
  /** Landing/pasarela que origina la campaña (C-2, opcional). */
  landingId: string;
}

const EMPTY_FORM: ICampaignFormState = {
  name: '',
  templateId: '',
  state: 'draft',
  schedule: '',
  segmentType: '',
  segmentTags: '',
  segmentMatch: 'any',
  triggerType: '',
  triggerEvent: '',
  landingId: '',
};

/** Estados estándar del ciclo de vida de una campaña con su etiqueta en español. */
const CAMPAIGN_STATES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'draft', label: 'Borrador' },
  { value: 'scheduled', label: 'Programada' },
  { value: 'sending', label: 'Enviando' },
  { value: 'sent', label: 'Enviada' },
  { value: 'cancelled', label: 'Cancelada' },
];

/** Tipos de segmentación de audiencia de una campaña (C-2). */
const SEGMENT_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Todas las audiencias' },
  { value: 'tags', label: 'Por etiquetas de contacto' },
  { value: 'event', label: 'Por evento' },
];

/** Modos de coincidencia para la segmentación por etiquetas (C-2). */
const SEGMENT_MATCHES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'any', label: 'Cualquiera (any)' },
  { value: 'all', label: 'Todas (all)' },
];

/** Tipos de disparo de una campaña (C-2). */
const TRIGGER_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Sin disparo' },
  { value: 'scheduled', label: 'Agendado' },
  { value: 'event', label: 'Por evento' },
];

/** Eventos de workflow que pueden disparar una campaña (C-2). */
const TRIGGER_EVENTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'checkout.created', label: 'checkout.created (carrito generado)' },
  { value: 'payment.completed', label: 'payment.completed (pago completado)' },
];

/** Estados de envío de un destinatario de campaña con su etiqueta en español (B.4). */
const RECIPIENT_STATES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'sending', label: 'Enviando' },
  { value: 'sent', label: 'Enviado' },
  { value: 'failed', label: 'Fallido' },
  { value: 'skipped', label: 'Omitido' },
];

/** Devuelve la etiqueta en español de un estado de destinatario (cae al valor crudo). */
function formatRecipientState(state: string): string {
  const match = RECIPIENT_STATES.find((option) => option.value === state);
  return match !== undefined ? match.label : state;
}

/** Devuelve la etiqueta en español de un estado de campaña (cae al valor crudo). */
function formatState(state: string): string {
  const match = CAMPAIGN_STATES.find((option) => option.value === state);
  return match !== undefined ? match.label : state;
}

/** Describe la segmentación de una campaña para la lista (C-2) o null si no aplica. */
function describeSegment(campaign: ICampaignRead): string | null {
  if (campaign.segment_type === 'tags') {
    const config = campaign.segment_config;
    const tags = Array.isArray(config?.tags)
      ? (config.tags as ReadonlyArray<unknown>).filter(
          (tag): tag is string => typeof tag === 'string',
        )
      : [];
    const match = config?.match === 'all' ? 'todas' : 'cualquiera';
    return tags.length > 0
      ? `Etiquetas (${match}): ${tags.join(', ')}`
      : 'Segmentación por etiquetas';
  }
  if (campaign.segment_type === 'event') {
    return 'Segmentación por evento';
  }
  return null;
}

/** Devuelve el nombre legible de una landing/pasarela por su id, o el id crudo. */
function landingLabel(landings: ReadonlyArray<ILandingRead>, landingId: string | null): string {
  if (landingId === null || landingId === '') {
    return '';
  }
  const landing = landings.find((item) => item.id === landingId);
  if (landing === undefined) {
    return landingId;
  }
  return landing.name.trim() === '' ? landing.id : landing.name;
}

/**
 * Sección de campañas de envío del bot con CRUD completo (B.4/C-2).
 *
 * @example
 * ```tsx
 * <CampaignsSection />
 * ```
 *
 * @returns El formulario de campañas y la lista de envíos del bot.
 */
export function CampaignsSection({ config }: { config: IAppConfig }): ReactElement {
  const campaigns = useOperationsStore((state) => state.campaigns);
  const campaignsStatus = useOperationsStore((state) => state.campaignsStatus);
  const campaignsError = useOperationsStore((state) => state.campaignsError);
  const listCampaigns = useOperationsStore((state) => state.listCampaigns);
  const createCampaign = useOperationsStore((state) => state.createCampaign);
  const updateCampaign = useOperationsStore((state) => state.updateCampaign);
  const deleteCampaign = useOperationsStore((state) => state.deleteCampaign);
  const dispatchResult = useOperationsStore((state) => state.dispatchResult);
  const dispatchStatus = useOperationsStore((state) => state.dispatchStatus);
  const dispatchError = useOperationsStore((state) => state.dispatchError);
  const dispatchCampaign = useOperationsStore((state) => state.dispatchCampaign);
  const campaignRecipients = useOperationsStore((state) => state.campaignRecipients);
  const campaignRecipientsStatus = useOperationsStore((state) => state.campaignRecipientsStatus);
  const campaignRecipientsError = useOperationsStore((state) => state.campaignRecipientsError);
  const listCampaignRecipients = useOperationsStore((state) => state.listCampaignRecipients);
  const addCampaignRecipient = useOperationsStore((state) => state.addCampaignRecipient);
  const updateCampaignRecipient = useOperationsStore((state) => state.updateCampaignRecipient);
  const importResult = useOperationsStore((state) => state.importResult);
  const importStatus = useOperationsStore((state) => state.importStatus);
  const importError = useOperationsStore((state) => state.importError);
  const importCampaignRecipientsCsv = useOperationsStore(
    (state) => state.importCampaignRecipientsCsv,
  );
  const templates = useOperationsStore((state) => state.templates);
  const templatesStatus = useOperationsStore((state) => state.templatesStatus);
  const listTemplates = useOperationsStore((state) => state.listTemplates);
  const individualSendResult = useOperationsStore((state) => state.individualSendResult);
  const individualSendStatus = useOperationsStore((state) => state.individualSendStatus);
  const individualSendError = useOperationsStore((state) => state.individualSendError);
  const sendIndividualMessage = useOperationsStore((state) => state.sendIndividualMessage);
  const recipientFiles = useOperationsStore((state) => state.recipientFiles);
  const recipientFilesStatus = useOperationsStore((state) => state.recipientFilesStatus);
  const recipientFilesError = useOperationsStore((state) => state.recipientFilesError);
  const listRecipientFiles = useOperationsStore((state) => state.listRecipientFiles);
  const uploadRecipientFile = useOperationsStore((state) => state.uploadRecipientFile);
  const recipientFilePreview = useOperationsStore((state) => state.recipientFilePreview);
  const recipientFilePreviewStatus = useOperationsStore(
    (state) => state.recipientFilePreviewStatus,
  );
  const recipientFilePreviewError = useOperationsStore((state) => state.recipientFilePreviewError);
  const previewRecipientFile = useOperationsStore((state) => state.previewRecipientFile);
  const dispatchCampaignFromFile = useOperationsStore((state) => state.dispatchCampaignFromFile);

  const [form, setForm] = useState<ICampaignFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [recipientsCampaignId, setRecipientsCampaignId] = useState<string | null>(null);
  const [recipientContactId, setRecipientContactId] = useState<string>('');
  const [recipientState, setRecipientState] = useState<string>('pending');
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [recipientsCsvText, setRecipientsCsvText] = useState<string>('');
  const [recipientsCsvError, setRecipientsCsvError] = useState<string | null>(null);
  const [dispatchTargetId, setDispatchTargetId] = useState<string | null>(null);
  const [individualTemplateId, setIndividualTemplateId] = useState<string>('');
  const [individualPhone, setIndividualPhone] = useState<string>('');
  const [individualVariablesText, setIndividualVariablesText] = useState<string>('');
  const [individualError, setIndividualError] = useState<string | null>(null);
  const [recipientFileCsvText, setRecipientFileCsvText] = useState<string>('');
  const [recipientFileCsvError, setRecipientFileCsvError] = useState<string | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [dispatchFromFileTargetId, setDispatchFromFileTargetId] = useState<string | null>(null);
  const [landings, setLandings] = useState<ILandingRead[]>([]);

  // Sección autocontenida: carga las campañas y las plantillas al montar.
  useEffect(() => {
    void listCampaigns();
    void listTemplates();
  }, [listCampaigns, listTemplates]);

  // Carga las landings/pasarelas reales del tenant para el selector de origen (C-2).
  useEffect(() => {
    const service = getLandingService();
    if (service === null) {
      return;
    }
    let cancelled = false;
    void service
      .list()
      .then((page) => {
        if (!cancelled) {
          setLandings(page.items);
        }
      })
      .catch(() => {
        // Si el listado de landings falla, el selector queda vacío sin romper la UI.
        if (!cancelled) {
          setLandings([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setField = <K extends keyof ICampaignFormState>(
    key: K,
    value: ICampaignFormState[K],
  ): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  };

  const resetForm = (): void => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
  };

  const startEdit = (campaign: ICampaignRead): void => {
    const config = campaign.segment_config ?? {};
    const tags = Array.isArray(config.tags) ? (config.tags as string[]) : [];
    setForm({
      name: campaign.name,
      templateId: campaign.template_id ?? '',
      state: campaign.state,
      schedule: campaign.schedule ?? '',
      segmentType: campaign.segment_type ?? '',
      segmentTags: tags.join(', '),
      segmentMatch: config.match === 'all' ? 'all' : 'any',
      triggerType: campaign.trigger_type ?? '',
      triggerEvent: campaign.trigger_event ?? '',
      landingId: campaign.landing_id ?? '',
    });
    setEditingId(campaign.id);
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const name = form.name.trim();
    if (name === '') {
      setFormError('El nombre es obligatorio.');
      return;
    }
    const input: ICampaignInput = {
      name,
      templateId: form.templateId.trim() === '' ? undefined : form.templateId.trim(),
      state: form.state,
      schedule: form.schedule.trim() === '' ? undefined : form.schedule.trim(),
      segmentType: form.segmentType === '' ? undefined : form.segmentType,
      segmentConfig:
        form.segmentType === 'tags'
          ? {
              tags: form.segmentTags
                .split(',')
                .map((tag) => tag.trim())
                .filter((tag) => tag !== ''),
              match: form.segmentMatch,
            }
          : undefined,
      triggerType: form.triggerType === '' ? undefined : form.triggerType,
      triggerEvent:
        form.triggerType === 'event' && form.triggerEvent !== '' ? form.triggerEvent : undefined,
      landingId: form.landingId.trim() === '' ? undefined : form.landingId.trim(),
    };
    if (editingId !== null) {
      await updateCampaign(editingId, input);
    } else {
      await createCampaign(input);
    }
    resetForm();
  };

  const handleDelete = async (campaign: ICampaignRead): Promise<void> => {
    await deleteCampaign(campaign.id);
  };

  const handleToggleRecipients = async (campaign: ICampaignRead): Promise<void> => {
    if (recipientsCampaignId === campaign.id) {
      setRecipientsCampaignId(null);
      return;
    }
    setRecipientsCampaignId(campaign.id);
    setRecipientContactId('');
    setRecipientState('pending');
    setRecipientError(null);
    setRecipientsCsvText('');
    setRecipientsCsvError(null);
    setDispatchTargetId(null);
    setRecipientFileCsvText('');
    setRecipientFileCsvError(null);
    setPreviewFileId(null);
    setDispatchFromFileTargetId(null);
    await listCampaignRecipients(campaign.id);
    if (config.features.recipientFiles) {
      await listRecipientFiles();
    }
  };

  const handleAddRecipient = async (campaignId: string): Promise<void> => {
    const contactId = recipientContactId.trim();
    if (contactId === '') {
      setRecipientError('El ID del contacto es obligatorio.');
      return;
    }
    const input: ICampaignRecipientInput = { contactId, state: recipientState };
    await addCampaignRecipient(campaignId, input);
    setRecipientContactId('');
    setRecipientError(null);
  };

  const handleRecipientStateChange = async (
    recipient: ICampaignRecipientRead,
    state: string,
  ): Promise<void> => {
    await updateCampaignRecipient(recipient.id, { state });
  };

  const handleDispatch = async (campaignId: string): Promise<void> => {
    setDispatchTargetId(campaignId);
    await dispatchCampaign(campaignId);
  };

  const handleRecipientsCsvFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }
    void file.text().then((text) => setRecipientsCsvText(text));
  };

  const handleImportRecipients = async (campaignId: string): Promise<void> => {
    const csv = recipientsCsvText.trim();
    if (csv === '') {
      setRecipientsCsvError('Pega el contenido CSV o sube un archivo antes de importar.');
      return;
    }
    const input: ICsvImportInput = { csv, delimiter: ',' };
    await importCampaignRecipientsCsv(campaignId, input);
    setRecipientsCsvError(null);
  };

  const handleRecipientFileCsvFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }
    void file.text().then((text) => setRecipientFileCsvText(text));
  };

  const handleUploadRecipientFile = async (): Promise<void> => {
    const csv = recipientFileCsvText.trim();
    if (csv === '') {
      setRecipientFileCsvError('Pega el contenido CSV o sube un archivo antes de guardarlo.');
      return;
    }
    const input: IRecipientFileInput = {
      name: `archivo-${new Date().toISOString().slice(0, 10)}`,
      contentType: 'text/csv',
      rawCsv: csv,
      sourceMeta: { delimiter: ',' },
    };
    setRecipientFileCsvError(null);
    await uploadRecipientFile(input);
    setRecipientFileCsvText('');
  };

  const handlePreviewRecipientFile = async (fileId: string): Promise<void> => {
    setPreviewFileId(fileId);
    await previewRecipientFile(fileId);
  };

  const handleDispatchFromFile = async (campaignId: string, fileId: string): Promise<void> => {
    setDispatchFromFileTargetId(fileId);
    await dispatchCampaignFromFile(campaignId, fileId);
  };

  const handleSendIndividual = async (): Promise<void> => {
    const templateId = individualTemplateId.trim();
    const phone = individualPhone.trim();
    if (templateId === '') {
      setIndividualError('Selecciona una plantilla para el envío individual.');
      return;
    }
    if (phone === '') {
      setIndividualError('El teléfono es obligatorio para el envío individual.');
      return;
    }
    const variables: Record<string, string> = {};
    for (const line of individualVariablesText.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') {
        continue;
      }
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) {
        setIndividualError(
          `Variable inválida: "${trimmed}". Usa el formato nombre=valor (una por línea).`,
        );
        return;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (key === '') {
        setIndividualError(`Variable inválida: "${trimmed}". El nombre no puede estar vacío.`);
        return;
      }
      variables[key] = value;
    }
    const input: IIndividualSendInput = {
      phone,
      template_id: templateId,
      variables,
    };
    setIndividualError(null);
    await sendIndividualMessage(input);
  };

  const isLoading = campaignsStatus === 'loading' && campaigns.length === 0;

  return (
    <section aria-labelledby="campaigns-heading">
      <h2 id="campaigns-heading" className="text-lg font-semibold text-slate-900">
        Campañas
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Envíos masivos e individuales con plantilla de mensaje y destinatarios del tenant. Cada
        campaña define su estado, programación, segmentación y disparo.
      </p>
      <span className="mt-2 inline-block rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
        Captación ① · Recuperación ⑦ · Recompra ⑨
      </span>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500" role="status">
          Cargando campañas…
        </p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4"
            aria-label={editingId !== null ? 'Editar campaña' : 'Crear campaña'}
          >
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
                {editingId !== null ? 'Editar campaña' : 'Nueva campaña'}
              </legend>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="campaign-name" className="block text-sm text-slate-600">
                    Nombre
                  </label>
                  <input
                    id="campaign-name"
                    type="text"
                    value={form.name}
                    onChange={(event) => setField('name', event.target.value)}
                    placeholder="Campaña de bienvenida"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="campaign-template" className="block text-sm text-slate-600">
                    Plantilla
                  </label>
                  <input
                    id="campaign-template"
                    type="text"
                    value={form.templateId}
                    onChange={(event) => setField('templateId', event.target.value)}
                    placeholder="61111111-1111-4111-8111-111111111111"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="campaign-state" className="block text-sm text-slate-600">
                    Estado
                  </label>
                  <select
                    id="campaign-state"
                    value={form.state}
                    onChange={(event) => setField('state', event.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  >
                    {CAMPAIGN_STATES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="campaign-schedule" className="block text-sm text-slate-600">
                    Programación
                  </label>
                  <input
                    id="campaign-schedule"
                    type="text"
                    value={form.schedule}
                    onChange={(event) => setField('schedule', event.target.value)}
                    placeholder="2026-08-20T10:00:00Z"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="campaign-landing-id" className="block text-sm text-slate-600">
                    Landing / pasarela de origen
                  </label>
                  <select
                    id="campaign-landing-id"
                    value={form.landingId}
                    onChange={(event) => setField('landingId', event.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Sin landing</option>
                    {landings.map((landing) => (
                      <option key={landing.id} value={landing.id}>
                        {landing.name.trim() === '' ? landing.id : landing.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="campaign-segment-type" className="block text-sm text-slate-600">
                    Segmentación
                  </label>
                  <select
                    id="campaign-segment-type"
                    value={form.segmentType}
                    onChange={(event) => setField('segmentType', event.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  >
                    {SEGMENT_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {form.segmentType === 'tags' && (
                  <>
                    <div>
                      <label
                        htmlFor="campaign-segment-tags"
                        className="block text-sm text-slate-600"
                      >
                        Etiquetas de contacto (separadas por coma)
                      </label>
                      <input
                        id="campaign-segment-tags"
                        type="text"
                        value={form.segmentTags}
                        onChange={(event) => setField('segmentTags', event.target.value)}
                        placeholder="cliente, vip"
                        className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="campaign-segment-match"
                        className="block text-sm text-slate-600"
                      >
                        Coincidencia
                      </label>
                      <select
                        id="campaign-segment-match"
                        value={form.segmentMatch}
                        onChange={(event) => setField('segmentMatch', event.target.value)}
                        className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                      >
                        {SEGMENT_MATCHES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                <div>
                  <label htmlFor="campaign-trigger-type" className="block text-sm text-slate-600">
                    Disparo
                  </label>
                  <select
                    id="campaign-trigger-type"
                    value={form.triggerType}
                    onChange={(event) => setField('triggerType', event.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  >
                    {TRIGGER_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {form.triggerType === 'event' && (
                  <div>
                    <label
                      htmlFor="campaign-trigger-event"
                      className="block text-sm text-slate-600"
                    >
                      Evento de disparo
                    </label>
                    <select
                      id="campaign-trigger-event"
                      value={form.triggerEvent}
                      onChange={(event) => setField('triggerEvent', event.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    >
                      {TRIGGER_EVENTS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </fieldset>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={campaignsStatus === 'loading'}
                className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editingId !== null ? 'Guardar cambios' : 'Crear campaña'}
              </button>
              {editingId !== null && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Cancelar edición
                </button>
              )}
              <span role="status" aria-live="polite" className="text-sm">
                {formError !== null && <span className="text-red-600">{formError}</span>}
              </span>
            </div>
          </form>

          <div>
            <p className="text-sm font-medium text-slate-700">Campañas de envío</p>
            {campaigns.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no hay campañas de envío.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {campaigns.map((campaign) => (
                  <li key={campaign.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {formatState(campaign.state)}
                          </span>
                        </div>
                        <h3 className="mt-1 truncate text-sm font-semibold text-slate-900">
                          {campaign.name}
                        </h3>
                        {campaign.template_id !== null && (
                          <span className="mt-2 inline-block rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                            Plantilla: {campaign.template_id}
                          </span>
                        )}
                        {landingLabel(landings, campaign.landing_id) !== '' && (
                          <span className="mt-2 inline-block rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                            Origen: {landingLabel(landings, campaign.landing_id)}
                          </span>
                        )}
                        {campaign.schedule !== null && (
                          <p className="mt-2 text-xs text-slate-500">
                            Programación: {campaign.schedule}
                          </p>
                        )}
                        {describeSegment(campaign) !== null && (
                          <span className="mt-2 inline-block rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            {describeSegment(campaign)}
                          </span>
                        )}
                        {campaign.trigger_type !== null && campaign.trigger_type !== '' && (
                          <span className="mt-2 inline-block rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            {campaign.trigger_type === 'event'
                              ? `Disparo por evento: ${campaign.trigger_event ?? '—'}`
                              : 'Disparo agendado'}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(campaign)}
                          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(campaign)}
                          className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                        <button
                          type="button"
                          aria-expanded={recipientsCampaignId === campaign.id}
                          onClick={() => void handleToggleRecipients(campaign)}
                          className={
                            recipientsCampaignId === campaign.id
                              ? 'rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white transition hover:bg-slate-900'
                              : 'rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100'
                          }
                        >
                          Destinatarios
                        </button>
                      </div>
                    </div>
                    {recipientsCampaignId === campaign.id && (
                      <div className="mt-4 border-t border-slate-200 pt-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-slate-700">Envío masivo</p>
                          <button
                            type="button"
                            disabled={dispatchStatus === 'loading'}
                            onClick={() => void handleDispatch(campaign.id)}
                            className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {dispatchStatus === 'loading' && dispatchTargetId === campaign.id
                              ? 'Enviando…'
                              : 'Enviar ahora'}
                          </button>
                        </div>
                        {dispatchTargetId === campaign.id && (
                          <div className="mt-2">
                            {dispatchError !== null && (
                              <p className="text-xs text-red-600">{dispatchError}</p>
                            )}
                            {dispatchResult !== null && (
                              <dl className="mt-2 grid grid-cols-2 gap-3 rounded bg-slate-50 p-3 text-sm sm:grid-cols-4">
                                <div>
                                  <dt className="text-xs text-slate-500">Campañas</dt>
                                  <dd className="font-medium text-slate-900">
                                    {dispatchResult.campaigns_processed}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-xs text-slate-500">Enviados</dt>
                                  <dd className="font-medium text-emerald-700">
                                    {dispatchResult.recipients_sent}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-xs text-slate-500">Fallidos</dt>
                                  <dd className="font-medium text-red-700">
                                    {dispatchResult.recipients_failed}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-xs text-slate-500">Omitidos</dt>
                                  <dd className="font-medium text-slate-600">
                                    {dispatchResult.recipients_skipped}
                                  </dd>
                                </div>
                              </dl>
                            )}
                          </div>
                        )}

                        <div className="mt-4">
                          <p className="text-sm font-medium text-slate-700">Añadir destinatario</p>
                          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                            <input
                              type="text"
                              value={recipientContactId}
                              onChange={(event) => setRecipientContactId(event.target.value)}
                              placeholder="contact_id (uuid)"
                              className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                            />
                            <select
                              value={recipientState}
                              onChange={(event) => setRecipientState(event.target.value)}
                              className="rounded border border-slate-300 px-3 py-2 text-sm"
                            >
                              {RECIPIENT_STATES.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={campaignRecipientsStatus === 'loading'}
                              onClick={() => void handleAddRecipient(campaign.id)}
                              className="rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Añadir
                            </button>
                          </div>
                          {recipientError !== null && (
                            <p className="mt-1 text-xs text-red-600">{recipientError}</p>
                          )}
                        </div>

                        <div className="mt-4">
                          <p className="text-sm font-medium text-slate-700">Destinatarios</p>
                          {campaignRecipientsStatus === 'loading' &&
                          campaignRecipients.length === 0 ? (
                            <p className="mt-2 text-xs text-slate-500" role="status">
                              Cargando destinatarios…
                            </p>
                          ) : campaignRecipients.length === 0 ? (
                            <p className="mt-2 text-xs text-slate-500" role="status">
                              Aún no hay destinatarios para esta campaña.
                            </p>
                          ) : (
                            <ul className="mt-2 space-y-2">
                              {campaignRecipients.map((recipient) => (
                                <li
                                  key={recipient.id}
                                  className="flex flex-wrap items-center gap-2 rounded border border-slate-200 px-3 py-2 text-xs"
                                >
                                  <code className="min-w-0 flex-1 truncate text-slate-600">
                                    {recipient.contact_id}
                                  </code>
                                  <span className="inline-block rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                                    {formatRecipientState(recipient.state)}
                                  </span>
                                  {recipient.result !== null && (
                                    <span className="text-slate-500">{recipient.result}</span>
                                  )}
                                  <span className="text-slate-400">
                                    intentos: {recipient.attempts}
                                  </span>
                                  <select
                                    value={recipient.state}
                                    onChange={(event) =>
                                      void handleRecipientStateChange(recipient, event.target.value)
                                    }
                                    aria-label={`Cambiar estado del destinatario ${recipient.contact_id}`}
                                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                                  >
                                    {RECIPIENT_STATES.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </li>
                              ))}
                            </ul>
                          )}
                          {campaignRecipientsError !== null && (
                            <p className="mt-2 text-xs text-red-600">{campaignRecipientsError}</p>
                          )}
                        </div>

                        <div className="mt-4">
                          <p className="text-sm font-medium text-slate-700">
                            Importar destinatarios (CSV)
                          </p>
                          <div className="mt-2 space-y-2">
                            <input
                              type="file"
                              accept=".csv,text/csv"
                              onChange={handleRecipientsCsvFile}
                              className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
                            />
                            <textarea
                              value={recipientsCsvText}
                              onChange={(event) => setRecipientsCsvText(event.target.value)}
                              placeholder={
                                'contact_id,estado,resultado,intentos\n61111111-1111-4111-8111-111111111111,pending,,0'
                              }
                              rows={3}
                              className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs"
                            />
                            <button
                              type="button"
                              disabled={importStatus === 'loading'}
                              onClick={() => void handleImportRecipients(campaign.id)}
                              className="rounded border border-brand-600 px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Importar destinatarios
                            </button>
                            {recipientsCsvError !== null && (
                              <p className="text-xs text-red-600">{recipientsCsvError}</p>
                            )}
                            {importError !== null && (
                              <p className="text-xs text-red-600">{importError}</p>
                            )}
                            {importResult !== null && (
                              <dl className="mt-2 grid grid-cols-3 gap-3 rounded bg-slate-50 p-3 text-sm">
                                <div>
                                  <dt className="text-xs text-slate-500">Creados</dt>
                                  <dd className="font-medium text-emerald-700">
                                    {importResult.created}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-xs text-slate-500">Omitidos</dt>
                                  <dd className="font-medium text-slate-600">
                                    {importResult.skipped}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-xs text-slate-500">Fallidos</dt>
                                  <dd className="font-medium text-red-700">
                                    {importResult.failed}
                                  </dd>
                                </div>
                                {importResult.errors.length > 0 && (
                                  <div className="col-span-3">
                                    <ul className="list-disc space-y-1 pl-4 text-xs text-red-600">
                                      {importResult.errors.map((error) => (
                                        <li key={error}>{error}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </dl>
                            )}
                          </div>
                        </div>

                        {config.features.recipientFiles && (
                          <div className="mt-4 border-t border-slate-200 pt-4">
                            <p className="text-sm font-medium text-slate-700">
                              Envío masivo sobre archivos existentes
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Reutiliza archivos de destinatarios guardados del tenant (GAP 2):
                              previsualiza sus contactos y despacha la campaña sobre ellos.
                            </p>

                            <div className="mt-3">
                              <p className="text-xs font-medium text-slate-600">
                                Archivos existentes
                              </p>
                              {recipientFilesStatus === 'loading' && recipientFiles.length === 0 ? (
                                <p className="mt-2 text-xs text-slate-500" role="status">
                                  Cargando archivos…
                                </p>
                              ) : recipientFiles.length === 0 ? (
                                <p className="mt-2 text-xs text-slate-500" role="status">
                                  Aún no hay archivos de destinatarios guardados.
                                </p>
                              ) : (
                                <ul className="mt-2 space-y-2">
                                  {recipientFiles.map((file) => (
                                    <li
                                      key={file.id}
                                      className="flex flex-wrap items-center gap-2 rounded border border-slate-200 px-3 py-2 text-xs"
                                    >
                                      <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                                        {file.name}
                                      </span>
                                      <span className="text-slate-400">{file.content_type}</span>
                                      <button
                                        type="button"
                                        disabled={recipientFilePreviewStatus === 'loading'}
                                        onClick={() => void handlePreviewRecipientFile(file.id)}
                                        className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        Vista previa de contactos
                                      </button>
                                      <button
                                        type="button"
                                        disabled={dispatchStatus === 'loading'}
                                        onClick={() =>
                                          void handleDispatchFromFile(campaign.id, file.id)
                                        }
                                        className="rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {dispatchStatus === 'loading' &&
                                        dispatchFromFileTargetId === file.id
                                          ? 'Enviando…'
                                          : 'Enviar desde archivo'}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {recipientFilesError !== null && (
                                <p className="mt-2 text-xs text-red-600">{recipientFilesError}</p>
                              )}
                            </div>

                            {previewFileId !== null && recipientFilePreview !== null && (
                              <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-xs font-medium text-slate-700">
                                    Vista previa: {recipientFilePreview.name} (
                                    {recipientFilePreview.total} contactos)
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => setPreviewFileId(null)}
                                    className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                                  >
                                    Cerrar
                                  </button>
                                </div>
                                {recipientFilePreviewStatus === 'loading' ? (
                                  <p className="mt-2 text-xs text-slate-500" role="status">
                                    Cargando vista previa…
                                  </p>
                                ) : recipientFilePreview.contacts.length === 0 ? (
                                  <p className="mt-2 text-xs text-slate-500" role="status">
                                    No se detectaron contactos en este archivo.
                                  </p>
                                ) : (
                                  <table className="mt-2 w-full text-left text-xs">
                                    <thead>
                                      <tr className="border-b border-slate-200 text-slate-500">
                                        <th className="py-1 pr-2 font-medium">Teléfono</th>
                                        <th className="py-1 pr-2 font-medium">Nombre</th>
                                        <th className="py-1 font-medium">Estado</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {recipientFilePreview.contacts.map((contact, index) => (
                                        <tr
                                          key={`${contact.phone}-${index}`}
                                          className="border-b border-slate-100"
                                        >
                                          <td className="py-1 pr-2 font-mono text-slate-700">
                                            {contact.phone}
                                          </td>
                                          <td className="py-1 pr-2 text-slate-600">
                                            {contact.name ?? '—'}
                                          </td>
                                          <td className="py-1 text-slate-600">
                                            {contact.state ?? '—'}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                                {recipientFilePreviewError !== null && (
                                  <p className="mt-2 text-xs text-red-600">
                                    {recipientFilePreviewError}
                                  </p>
                                )}
                              </div>
                            )}

                            <div className="mt-3">
                              <p className="text-xs font-medium text-slate-600">
                                Guardar nuevo archivo de destinatarios
                              </p>
                              <div className="mt-2 space-y-2">
                                <input
                                  type="file"
                                  accept=".csv,text/csv"
                                  onChange={handleRecipientFileCsvFile}
                                  className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
                                />
                                <textarea
                                  value={recipientFileCsvText}
                                  onChange={(event) => setRecipientFileCsvText(event.target.value)}
                                  placeholder={'phone,name\n5215512345678,Ana García'}
                                  rows={3}
                                  className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs"
                                />
                                <button
                                  type="button"
                                  disabled={recipientFilesStatus === 'loading'}
                                  onClick={() => void handleUploadRecipientFile()}
                                  className="rounded border border-brand-600 px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Guardar archivo
                                </button>
                                {recipientFileCsvError !== null && (
                                  <p className="text-xs text-red-600">{recipientFileCsvError}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="mt-8 border-t border-slate-200 pt-6">
        <h3 className="text-base font-semibold text-slate-900">Envío individual</h3>
        <p className="mt-1 text-sm text-slate-500">
          Envía un mensaje puntual a un teléfono reutilizando una plantilla del tenant, sin crear
          una campaña (B.4).
        </p>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <label htmlFor="individual-template" className="block text-sm text-slate-600">
                Plantilla
              </label>
              {templatesStatus === 'loading' && templates.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500" role="status">
                  Cargando plantillas…
                </p>
              ) : templates.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500" role="status">
                  Aún no hay plantillas. Créalas en la sección Plantillas.
                </p>
              ) : (
                <select
                  id="individual-template"
                  value={individualTemplateId}
                  onChange={(event) => {
                    setIndividualTemplateId(event.target.value);
                    setIndividualError(null);
                  }}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Selecciona una plantilla…</option>
                  {templates.map((template: ITemplateRead) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label htmlFor="individual-phone" className="block text-sm text-slate-600">
                Teléfono
              </label>
              <input
                id="individual-phone"
                type="text"
                value={individualPhone}
                onChange={(event) => {
                  setIndividualPhone(event.target.value);
                  setIndividualError(null);
                }}
                placeholder="5215512345678"
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="individual-variables" className="block text-sm text-slate-600">
                Variables (opcional, una por línea con formato nombre=valor)
              </label>
              <textarea
                id="individual-variables"
                value={individualVariablesText}
                onChange={(event) => {
                  setIndividualVariablesText(event.target.value);
                  setIndividualError(null);
                }}
                placeholder={'nombre=María\nmonto=1500'}
                rows={3}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={individualSendStatus === 'loading'}
                onClick={() => void handleSendIndividual()}
                className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {individualSendStatus === 'loading' ? 'Enviando…' : 'Enviar mensaje'}
              </button>
              <span role="status" aria-live="polite" className="text-sm">
                {individualError !== null && (
                  <span className="text-red-600">{individualError}</span>
                )}
                {individualSendError !== null && (
                  <span className="text-red-600">{individualSendError}</span>
                )}
              </span>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700">Resultado del último envío</p>
            {individualSendResult === null ? (
              <p className="mt-2 text-sm text-slate-500" role="status">
                Aún no se ha ejecutado ningún envío individual.
              </p>
            ) : (
              <dl className="mt-2 grid grid-cols-2 gap-3 rounded bg-slate-50 p-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Estado</dt>
                  <dd className="font-medium text-slate-900">
                    {individualSendResult.state === 'sent'
                      ? 'Enviado'
                      : individualSendResult.state === 'failed'
                        ? 'Fallido'
                        : 'Omitido'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Teléfono</dt>
                  <dd className="font-medium text-slate-900">{individualSendResult.phone}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-slate-500">Resultado</dt>
                  <dd className="font-medium text-slate-900">{individualSendResult.result}</dd>
                </div>
              </dl>
            )}
          </div>
        </div>
      </div>

      <span role="status" aria-live="polite" className="text-sm">
        {campaignsError !== null && <span className="text-red-600">{campaignsError}</span>}
      </span>
    </section>
  );
}
