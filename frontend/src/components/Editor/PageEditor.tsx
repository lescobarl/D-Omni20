/**
 * Configurador único (modo landing / portal) del editor visual.
 *
 * Contrato:
 * - Es la ÚNICA fuente de orquestación del configurador: carga la lista de
 *   entidades del tenant, permite seleccionar una para cargar su configuración,
 *   crear una nueva, guardar (crear/actualizar) y publicar/despublicar.
 * - El modo se selecciona por prop/flag (`mode: 'landing' | 'portal'`), NO por
 *   un editor duplicado. `LandingEditor` y `PortalEditor` son envoltorios finos
 *   que delegan aquí con su modo correspondiente.
 * - Reutiliza el mismo `EditorLayout` tri-panel y provee el store activo
 *   (`useEditorStore` para landing, `usePortalStore` para portal) mediante
 *   `EditorStoreContext`, de modo que todos los componentes compartidos
 *   (Canvas, EditorSidebar, EditorRightPanel, AIPanel, PreviewPanel, etc.)
 *   operan sobre la configuración sin cambios.
 * - Cada modo encapsula su store, servicio (DI), mensajes, configuración de UI
 *   y operaciones (carga de lista/entidad, creación, guardado y publicación).
 *   El componente solo orquesta el estado local (status/message/options/
 *   selectedId) y delega las mutaciones del store en el modo activo.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { EditorLayout } from '@/components/Editor/EditorLayout';
import { EditorStoreContext, type EditorStoreApi } from '@/store/editorStoreContext';
import {
  deserializeLandingConfig,
  getLandingService,
  serializeLandingConfig,
  useEditorStore,
} from '@/store/editorStore';
import { getPortalService, usePortalStore } from '@/store/portalStore';
import { useTenantStore } from '@/store/tenantStore';
import { getActiveTenantSlug } from '@/lib/tenantContext';
import type { IAppConfig } from '@/types/config';
import type { IEditorState } from '@/types/editor';
import type { ILandingRead, IPortalPageRead } from '@/api/types';
import type { ILandingService } from '@/services/landingService';
import type { IPortalService } from '@/services/portalService';
import { uuidv4 } from '@/utils/uuid';

/** Modo del configurador único. */
export type PageEditorMode = 'landing' | 'portal';

/** Estado de la operación de guardado/publicación. */
type PageActionStatus = 'idle' | 'loading' | 'saving' | 'success' | 'error';

/** Opción del selector de entidades (una entidad persistida del tenant). */
interface IPageOption {
  /** Identificador único de la entidad persistida. */
  id: string;
  /** Nombre legible de la entidad para el selector. */
  name: string;
}

/** Resultado de una operación de guardado. */
interface ISaveResult {
  /** Mensaje de éxito mostrado en la barra de estado. */
  message: string;
  /** Entidad recién creada (se añade al selector y se selecciona). */
  option?: IPageOption;
  /** Entidad actualizada (se actualiza su opción en el selector). */
  updatedOption?: IPageOption;
}

/** Resultado de una operación de publicación. */
interface IPublishResult {
  /** Mensaje de éxito mostrado en la barra de estado. */
  message: string;
  /** URL amigable de la entidad publicada (solo landing). */
  url?: string;
}

/**
 * Estado del store del configurador único (superset permisivo de `IEditorState`).
 * Los campos de portal (`slug`, `pageId`, `published`) solo existen en el modo
 * portal; en el modo landing quedan `undefined` pero no se usan.
 */
export interface IPageEditorState extends IEditorState {
  /** Slug de la página del portal (solo modo portal). */
  slug?: string;
  /** Identificador de la página del portal persistida (solo modo portal). */
  pageId?: string | null;
  /** Indica si la página del portal está publicada (solo modo portal). */
  published?: boolean;
  /** Actualiza el slug de la página del portal (solo modo portal). */
  setSlug?(slug: string): void;
  /** Actualiza el estado de publicación de la página del portal (solo modo portal). */
  setPublished?(published: boolean): void;
  /** Actualiza el identificador de la página del portal (solo modo portal). */
  setPageId?(pageId: string | null): void;
  /** Serializa los bloques del store al formato del backend (solo modo portal). */
  toBackendBlocks?(): Record<string, unknown>;
  /** Aplica los bloques crudos del backend al store (solo modo portal). */
  applyBackendBlocks?(raw: Record<string, unknown>): void;
}

/** Superficie permisiva del hook de store (zustand) del configurador único. */
export interface IPageEditorStore {
  /** Invocación con selector: devuelve la porción seleccionada del estado. */
  <T>(selector: (state: IPageEditorState) => T): T;
  /** Invocación sin selector: devuelve el estado completo. */
  (): IPageEditorState;
  /** Devuelve el estado actual del store. */
  getState(): IPageEditorState;
  /** Actualiza (parcial o totalmente) el estado del store. */
  setState(
    partial:
      | IPageEditorState
      | Partial<IPageEditorState>
      | ((state: IPageEditorState) => IPageEditorState | Partial<IPageEditorState>),
    replace?: boolean,
  ): void;
  /** Suscribe un listener a los cambios de estado; devuelve la función de cancelación. */
  subscribe(listener: (state: IPageEditorState, prevState: IPageEditorState) => void): () => void;
  /** Devuelve el estado inicial del store. */
  getInitialState(): IPageEditorState;
}

/** Configuración de UI específica de cada modo. */
interface IPageModeUi {
  /** Etiqueta del selector de entidades. */
  selectLabel: string;
  /** Identificador del selector de entidades (accesibilidad). */
  selectId: string;
  /** Texto de marcador de posición del selector. */
  selectPlaceholder: string;
  /** Etiqueta del campo de título. */
  titleLabel: string;
  /** Identificador del campo de título (accesibilidad). */
  titleInputId: string;
  /** Texto de marcador de posición del campo de título. */
  titlePlaceholder: string;
  /** Indica si el modo muestra el campo de slug. */
  showSlug: boolean;
  /** Identificador del campo de slug (accesibilidad). */
  slugInputId: string;
  /** Texto de marcador de posición del campo de slug. */
  slugPlaceholder: string;
  /** Etiqueta del botón de crear entidad nueva. */
  newButtonLabel: string;
  /** Etiqueta del botón de publicar según el estado de publicación. */
  publishButtonLabel: (published: boolean) => string;
  /** Indica si el modo muestra el estado vacío cuando no hay entidades. */
  showEmptyState: boolean;
  /** Título del estado vacío. */
  emptyStateTitle: string;
  /** Cuerpo descriptivo del estado vacío. */
  emptyStateBody: string;
  /** Etiqueta del botón del estado vacío. */
  emptyStateButtonLabel: string;
  /** Indica si el modo muestra la barra de identidad de la entidad. */
  showIdentityBar: boolean;
}

/**
 * Modo del configurador único: encapsula el store, el servicio y las
 * operaciones específicas de landing o portal.
 */
export interface IPageEditorMode {
  /** Store activo (landing o portal) tipado de forma permisiva. */
  store: IPageEditorStore;
  /** Indica si el modo es portal (afecta a la lógica de guardado/publicación). */
  isPortal: boolean;
  /** Configuración de UI del modo. */
  ui: IPageModeUi;
  /** Mensajes específicos del modo. */
  messages: {
    serviceUnavailable: string;
    emptyList: string;
    loadListError: string;
    loadError: string;
    newMessage: string;
    validateMessage: string;
    saveCreateMessage: string;
    saveUpdateMessage: string;
    saveError: string;
    publishGuardMessage: string;
    publishSuccessMessage: (published: boolean) => string;
    publishErrorMessage: string;
    defaultStatusText: (published: boolean, hasLoaded: boolean) => string;
  };
  /** Indica si el servicio del modo está registrado (DI). */
  isServiceAvailable(): boolean;
  /** Carga la lista de entidades del tenant. */
  loadList(): Promise<IPageOption[]>;
  /** Carga la configuración de una entidad en el store. */
  loadItem(id: string): Promise<{ name: string; message: string }>;
  /** Crea una entidad nueva en blanco (sin persistir). */
  createNew(): void;
  /** Guarda (crea/actualiza) la entidad en edición. */
  save(selectedId: string): Promise<ISaveResult>;
  /** Publica/despublica la entidad en edición. */
  publish(selectedId: string): Promise<IPublishResult>;
}

/**
 * Normaliza un identificador de tenant a un subdominio DNS válido.
 */
function toSubdomain(tenantId: string): string {
  return tenantId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Construye la URL amigable de una landing publicada a partir del tenant.
 * El backend sirve las landings bajo el subdominio del tenant; la ruta usa el
 * `name` normalizado de la landing como slug. El dominio base de subdominios
 * proviene de la configuración (no está hardcodeado).
 */
function buildFriendlyUrl(
  tenantId: string,
  landing: ILandingRead,
  clientSubdomainBase: string,
): string {
  const slug = landing.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = toSubdomain(tenantId);
  return `https://${base}.${clientSubdomainBase}/${slug}`;
}

/**
 * Construye la URL amigable del portal publicado a partir del tenant.
 * El backend sirve el portal completo (multi-página) bajo el subdominio del
 * tenant en la ruta determinista `/portal`. El dominio base de subdominios
 * proviene de la configuración (no está hardcodeado).
 */
function buildPortalUrl(tenantId: string, clientSubdomainBase: string): string {
  const base = toSubdomain(tenantId);
  return `https://${base}.${clientSubdomainBase}/portal`;
}

/** Crea el modo landing del configurador único. */
function createLandingMode(config: IAppConfig): IPageEditorMode {
  const store = useEditorStore as unknown as IPageEditorStore;
  const service = (): ILandingService | null => getLandingService();
  const isPortal = false;

  const ui: IPageModeUi = {
    selectLabel: 'Landing',
    selectId: 'landing-select',
    selectPlaceholder: '— Selecciona una landing —',
    titleLabel: 'Nombre',
    titleInputId: 'landing-title',
    titlePlaceholder: 'Nombre de la landing',
    showSlug: false,
    slugInputId: 'landing-slug',
    slugPlaceholder: '',
    newButtonLabel: 'Nueva',
    publishButtonLabel: () => 'Publicar',
    showEmptyState: false,
    emptyStateTitle: '',
    emptyStateBody: '',
    emptyStateButtonLabel: '',
    showIdentityBar: false,
  };

  const messages = {
    serviceUnavailable: 'El servicio de landings no está disponible.',
    emptyList: 'No hay landings guardadas. Crea una nueva y pulsa Guardar.',
    loadListError: 'No se pudieron cargar las landings del tenant.',
    loadError: 'No se pudo cargar la landing.',
    newMessage: 'Nueva landing en blanco. Pulsa Guardar para persistirla.',
    validateMessage: 'Introduce un nombre para la landing.',
    saveCreateMessage: 'Landing creada.',
    saveUpdateMessage: 'Landing guardada.',
    saveError: 'No se pudo guardar la landing.',
    publishGuardMessage: 'Guarda la landing antes de publicarla.',
    publishSuccessMessage: (_published: boolean) => 'Landing publicada.',
    publishErrorMessage: 'No se pudo publicar la landing.',
    defaultStatusText: (_published: boolean, hasLoaded: boolean) =>
      hasLoaded ? 'Landing cargada' : 'Borrador local',
  };

  const loadList = async (): Promise<IPageOption[]> => {
    const svc = service();
    if (svc === null) {
      return [];
    }
    const page = await svc.list({ page: 1, page_size: 100 });
    return page.items.map((item) => ({ id: item.id, name: item.name }));
  };

  const loadItem = async (id: string): Promise<{ name: string; message: string }> => {
    const svc = service();
    if (svc === null) {
      throw new Error(messages.serviceUnavailable);
    }
    const read = await svc.get(id);
    const loaded = deserializeLandingConfig(read.config);
    // Conserva el id y la campaña reales para el round-trip y el despliegue CDN.
    store.getState().setLanding({ ...loaded, id: read.id, campaignId: read.campaign_id });
    return { name: read.name, message: `Landing «${read.name}» cargada.` };
  };

  const createNew = (): void => {
    store.getState().setLanding({
      id: uuidv4(),
      campaignId: '',
      title: 'Nueva Landing',
      workflowType: 'direct_checkout',
      blocks: [],
    });
  };

  const save = async (selectedId: string): Promise<ISaveResult> => {
    const svc = service();
    if (svc === null) {
      throw new Error(messages.serviceUnavailable);
    }
    const state = store.getState();
    const landing = state.landing;
    const name = landing.title.trim();
    if (!name) {
      throw new Error(messages.validateMessage);
    }
    const configPayload = serializeLandingConfig(landing);
    if (landing.id && selectedId) {
      const updated = await svc.update(landing.id, { name, config: configPayload });
      store.getState().setLanding({ ...landing, id: updated.id, campaignId: updated.campaign_id });
      return { message: messages.saveUpdateMessage };
    }
    const campaignId = landing.campaignId || uuidv4();
    const created = await svc.create({ campaign_id: campaignId, name, config: configPayload });
    store.getState().setLanding({ ...landing, id: created.id, campaignId: created.campaign_id });
    return {
      message: messages.saveCreateMessage,
      option: { id: created.id, name: created.name },
    };
  };

  const publish = async (selectedId: string): Promise<IPublishResult> => {
    const svc = service();
    if (svc === null) {
      throw new Error(messages.serviceUnavailable);
    }
    const state = store.getState();
    const landing = state.landing;
    if (!landing.id || !selectedId) {
      throw new Error(messages.publishGuardMessage);
    }
    const updated = await svc.publish(landing.id, { published: true });
    store.getState().setLanding({ ...landing, id: updated.id, campaignId: updated.campaign_id });
    // La URL amigable debe reflejar el tenant ACTIVO en runtime (no el de arranque
    // de la configuración), ya que el backend sirve bajo el subdominio del tenant
    // seleccionado. El subdominio usa el SLUG del tenant (no el UUID), por eso se
    // lee `getActiveTenantSlug()` en el momento de publicar.
    const tenantId = getActiveTenantSlug() ?? config.tenantId;
    return {
      message: messages.publishSuccessMessage(true),
      url: buildFriendlyUrl(tenantId, updated, config.clientSubdomainBase),
    };
  };

  return { store, isPortal, ui, messages, isServiceAvailable: () => service() !== null, loadList, loadItem, createNew, save, publish };
}

/** Crea el modo portal del configurador único. */
function createPortalMode(_config: IAppConfig): IPageEditorMode {
  const store = usePortalStore as unknown as IPageEditorStore;
  const service = (): IPortalService | null => getPortalService();
  const isPortal = true;

  const ui: IPageModeUi = {
    selectLabel: 'Página',
    selectId: 'portal-page-select',
    selectPlaceholder: '— Selecciona una página —',
    titleLabel: 'Título',
    titleInputId: 'portal-title',
    titlePlaceholder: 'Título de la página',
    showSlug: true,
    slugInputId: 'portal-slug',
    slugPlaceholder: 'mi-empresa',
    newButtonLabel: 'Nueva',
    publishButtonLabel: (published: boolean) => (published ? 'Despublicar' : 'Publicar'),
    showEmptyState: true,
    emptyStateTitle: 'Aún no hay páginas en el portal',
    emptyStateBody:
      'Crea la primera página del portal: escribe un título y un slug en la barra superior y pulsa Guardar para persistirla.',
    emptyStateButtonLabel: 'Crear primera página',
    showIdentityBar: true,
  };

  const messages = {
    serviceUnavailable: 'El servicio del portal no está disponible.',
    emptyList: 'No hay páginas del portal. Crea la primera página y pulsa Guardar.',
    loadListError: 'No se pudieron cargar las páginas del portal.',
    loadError: 'No se pudo cargar la página del portal.',
    newMessage: 'Nueva página del portal en blanco. Escribe un título y un slug, y pulsa Guardar.',
    validateMessage: 'Introduce un slug para la página del portal.',
    saveCreateMessage: 'Página del portal creada.',
    saveUpdateMessage: 'Página del portal guardada.',
    saveError: 'No se pudo guardar la página del portal.',
    publishGuardMessage: 'Guarda la página antes de publicarla.',
    publishSuccessMessage: (published: boolean) =>
      published ? 'Página del portal publicada.' : 'Página del portal despublicada.',
    publishErrorMessage: 'No se pudo actualizar la publicación.',
    defaultStatusText: (published: boolean) => (published ? 'Publicado' : 'Borrador'),
  };

  const loadList = async (): Promise<IPageOption[]> => {
    const svc = service();
    if (svc === null) {
      return [];
    }
    const result = svc.list({ page: 1, page_size: 100 });
    if (result === undefined || typeof (result as PromiseLike<unknown> | undefined)?.then !== 'function') {
      return [];
    }
    const page = await result;
    return page.items.map((item) => ({ id: item.id, name: item.title || item.slug }));
  };

  const loadItem = async (id: string): Promise<{ name: string; message: string }> => {
    const svc = service();
    if (svc === null) {
      throw new Error(messages.serviceUnavailable);
    }
    const read: IPortalPageRead = await svc.get(id);
    const s = store.getState();
    s.setSlug?.(read.slug);
    s.setPageId?.(read.id);
    s.setPublished?.(read.published);
    s.applyBackendBlocks?.(read.blocks);
    // El título canónico de la página es el de nivel superior de la respuesta.
    s.setLandingTitle(read.title);
    return { name: read.title, message: `Página «${read.title}» cargada.` };
  };

  const createNew = (): void => {
    // `reset()` ya restablece slug, pageId, published y el landing por defecto,
    // por lo que los setters previos eran redundantes (doble reinicio).
    usePortalStore.getState().reset();
  };

  const save = async (_selectedId: string): Promise<ISaveResult> => {
    const svc = service();
    if (svc === null) {
      throw new Error(messages.serviceUnavailable);
    }
    const s = store.getState();
    const slug = s.slug ?? '';
    const title = s.landing.title;
    if (!slug.trim()) {
      throw new Error('Introduce un slug para la página del portal.');
    }
    if (!title.trim()) {
      throw new Error('Introduce un título para la página del portal.');
    }
    const blocks = s.toBackendBlocks?.() ?? {};
    if (s.pageId === null || s.pageId === undefined) {
      const created = await svc.create({ slug: slug.trim(), title: title.trim(), blocks });
      store.getState().setPageId?.(created.id);
      store.getState().setPublished?.(created.published);
      return {
        message: messages.saveCreateMessage,
        option: { id: created.id, name: created.title || created.slug },
      };
    }
    const updated = await svc.update(s.pageId, {
      slug: slug.trim(),
      title: title.trim(),
      blocks,
    });
    store.getState().setPublished?.(updated.published);
    return {
      message: messages.saveUpdateMessage,
      updatedOption: { id: updated.id, name: updated.title || updated.slug },
    };
  };

  const publish = async (_selectedId: string): Promise<IPublishResult> => {
    const s = store.getState();
    // Guarda antes de publicar: el guard se evalúa ANTES del servicio (contrato).
    if (s.pageId === null || s.pageId === undefined) {
      throw new Error(messages.publishGuardMessage);
    }
    const svc = service();
    if (svc === null) {
      throw new Error(messages.serviceUnavailable);
    }
    const updated = await svc.publish(s.pageId, { published: !s.published });
    store.getState().setPublished?.(updated.published);
    return { message: messages.publishSuccessMessage(updated.published) };
  };

  return { store, isPortal, ui, messages, isServiceAvailable: () => service() !== null, loadList, loadItem, createNew, save, publish };
}

interface IPageEditorProps {
  /** Configuración validada de la aplicación. */
  config: IAppConfig;
  /** Modo del configurador único (landing o portal). */
  mode: PageEditorMode;
  /** Oculta el selector interno del modo (cuando un selector unificado externo lo sustituye). */
  hideSelector?: boolean;
  /** Identificador de la entidad a cargar automáticamente al montar (selector unificado). */
  initialSelectedId?: string;
}

/**
 * Configurador único (modo landing / portal).
 *
 * @example
 * ```tsx
 * <PageEditor config={config} mode="landing" />
 * <PageEditor config={config} mode="portal" />
 * <PageEditor config={config} mode="portal" hideSelector initialSelectedId="page-1" />
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns El layout tri-panel del editor con la barra de herramientas del modo.
 */
export function PageEditor({
  config,
  mode,
  hideSelector = false,
  initialSelectedId,
}: IPageEditorProps): ReactElement {
  const editorMode = useMemo(
    () => (mode === 'portal' ? createPortalMode(config) : createLandingMode(config)),
    [mode, config],
  );
  const store = editorMode.store;
  const isPortal = editorMode.isPortal;

  // Lecturas reactivas del store activo (todas las lecturas son seguras: en el
  // modo landing los campos de portal quedan `undefined` pero no se usan).
  const title = store((state) => state.landing.title);
  const setLandingTitle = store((state) => state.setLandingTitle);
  const landingId = store((state) => state.landing.id);
  const slug = store((state) => state.slug);
  const setSlug = store((state) => state.setSlug);
  const pageId = store((state) => state.pageId);
  const published = store((state) => state.published);
  // Tenant activo en runtime (reactivo): la URL pública debe reflejar el tenant
  // seleccionado en la UI, no el tenant de arranque de la configuración.
  const activeTenantId = useTenantStore((state) => state.activeTenantId);
  const runtimeTenantId = activeTenantId ?? config.tenantId;

  const [status, setStatus] = useState<PageActionStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [options, setOptions] = useState<IPageOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [friendlyUrl, setFriendlyUrl] = useState<string | null>(null);

  /** Contador de secuencia para descartar respuestas obsoletas al cambiar de entidad. */
  const loadSeqRef = useRef(0);

  const serviceAvailable = editorMode.isServiceAvailable();

  /** Carga la lista de entidades del tenant al montar (si el servicio está registrado). */
  useEffect(() => {
    if (!serviceAvailable) {
      return;
    }
    let cancelled = false;
    setStatus('loading');
    editorMode
      .loadList()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setOptions(loaded);
        setStatus('idle');
        if (loaded.length === 0) {
          setMessage(editorMode.messages.emptyList);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setStatus('error');
        setMessage(
          error instanceof Error ? error.message : editorMode.messages.loadListError,
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode]);

  /**
   * Carga automáticamente la entidad indicada por `initialSelectedId` cuando el
   * selector unificado externo (SiteEditor) ya pobló la lista y aún no hay una
   * selección activa. Se dispara una sola vez por cambio de entidad objetivo.
   */
  useEffect(() => {
    if (!initialSelectedId || selectedId === initialSelectedId) {
      return;
    }
    if (options.length === 0 || status === 'loading' || status === 'saving') {
      return;
    }
    const seq = ++loadSeqRef.current;
    setSelectedId(initialSelectedId);
    setFriendlyUrl(null);
    if (!serviceAvailable) {
      setStatus('error');
      setMessage(editorMode.messages.serviceUnavailable);
      return;
    }
    setStatus('loading');
    setMessage(null);
    editorMode
      .loadItem(initialSelectedId)
      .then((loaded) => {
        if (seq !== loadSeqRef.current) {
          return;
        }
        setStatus('success');
        setMessage(loaded.message);
      })
      .catch((error: unknown) => {
        if (seq !== loadSeqRef.current) {
          return;
        }
        setStatus('error');
        setMessage(error instanceof Error ? error.message : editorMode.messages.loadError);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedId, selectedId, options.length, status, serviceAvailable, editorMode]);

  /** Carga la configuración de una entidad seleccionada en el canvas. */
  const handleSelect = async (event: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
    const id = event.target.value;
    const seq = ++loadSeqRef.current;
    setSelectedId(id);
    setFriendlyUrl(null);
    if (!id) {
      return;
    }
    if (!serviceAvailable) {
      setStatus('error');
      setMessage(editorMode.messages.serviceUnavailable);
      return;
    }
    setStatus('loading');
    setMessage(null);
    try {
      const loaded = await editorMode.loadItem(id);
      if (seq !== loadSeqRef.current) {
        // Una selección más reciente ya cargó otra entidad: descarta esta respuesta.
        return;
      }
      setStatus('success');
      setMessage(loaded.message);
    } catch (error) {
      if (seq !== loadSeqRef.current) {
        return;
      }
      setStatus('error');
      setMessage(error instanceof Error ? error.message : editorMode.messages.loadError);
    }
  };

  /** Crea una entidad nueva en blanco (sin persistir todavía). */
  const handleNew = (): void => {
    loadSeqRef.current += 1;
    setSelectedId('');
    setFriendlyUrl(null);
    editorMode.createNew();
    setStatus('idle');
    setMessage(editorMode.messages.newMessage);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setStatus('saving');
    setMessage(null);
    try {
      const result = await editorMode.save(selectedId);
      if (result.option) {
        setSelectedId(result.option.id);
        setOptions((current) => {
          if (current.some((option) => option.id === result.option?.id)) {
            return current;
          }
          return result.option ? [...current, result.option] : current;
        });
      } else if (result.updatedOption) {
        setOptions((current) =>
          current.map((option) =>
            option.id === result.updatedOption?.id ? result.updatedOption : option,
          ),
        );
      }
      setStatus('success');
      setMessage(result.message);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : editorMode.messages.saveError);
    }
  };

  const handlePublish = async (): Promise<void> => {
    setStatus('saving');
    setMessage(null);
    try {
      const result = await editorMode.publish(selectedId);
      if (result.url) {
        setFriendlyUrl(result.url);
      }
      setStatus('success');
      setMessage(result.message);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : editorMode.messages.publishErrorMessage);
    }
  };

  const hasLoadedLanding = Boolean(landingId && selectedId);
  const isLoading = status === 'loading';
  const isSaving = status === 'saving';

  // El estado vacío solo aplica cuando hay servicio y el modo lo soporta (portal).
  const isEmpty =
    editorMode.ui.showEmptyState &&
    serviceAvailable &&
    options.length === 0 &&
    !isLoading &&
    status !== 'error';

  const statusText = useMemo(() => {
    if (message !== null) {
      return message;
    }
    if (isLoading) {
      return 'Cargando…';
    }
    if (isSaving) {
      return 'Guardando…';
    }
    return editorMode.messages.defaultStatusText(Boolean(published), hasLoadedLanding);
  }, [message, isLoading, isSaving, published, hasLoadedLanding, editorMode]);

  const currentIdentity = useMemo(() => {
    if (!isPortal || pageId === null || pageId === undefined) {
      return null;
    }
    return { title, slug: slug ?? '' };
  }, [isPortal, pageId, title, slug]);

  const portalUrl = useMemo(
    () => buildPortalUrl(runtimeTenantId, config.clientSubdomainBase),
    [runtimeTenantId, config.clientSubdomainBase],
  );

  // Lógica de deshabilitado específica de cada modo.
  const selectDisabled = isSaving || isLoading || (!isPortal && !serviceAvailable);
  const newDisabled = isSaving || (!isPortal && !serviceAvailable);
  const saveDisabled = isSaving || (!isPortal && (isLoading || !serviceAvailable));
  const publishDisabled =
    isSaving || (!isPortal && (isLoading || !serviceAvailable || !hasLoadedLanding));

  const ui = editorMode.ui;

  return (
    <EditorStoreContext.Provider value={editorMode.store as unknown as EditorStoreApi}>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
          {!hideSelector && (
            <>
              <label htmlFor={ui.selectId} className="text-sm font-medium text-slate-600">
                {ui.selectLabel}
              </label>
              <select
                id={ui.selectId}
                value={selectedId}
                onChange={(event) => {
                  void handleSelect(event);
                }}
                disabled={selectDisabled}
                className="w-56 rounded border border-slate-300 px-3 py-1 text-sm text-slate-900 focus:border-brand-500 focus:outline-none disabled:opacity-50"
              >
                <option value="">{ui.selectPlaceholder}</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <button
            type="button"
            onClick={handleNew}
            disabled={newDisabled}
            className="rounded border border-slate-200 px-3 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {ui.newButtonLabel}
          </button>
          <form onSubmit={handleSave} className="flex flex-wrap items-center gap-3">
            <label htmlFor={ui.titleInputId} className="text-sm font-medium text-slate-600">
              {ui.titleLabel}
            </label>
            <input
              id={ui.titleInputId}
              type="text"
              value={title}
              onChange={(event) => setLandingTitle(event.target.value)}
              placeholder={ui.titlePlaceholder}
              className="w-56 rounded border border-slate-300 px-3 py-1 text-sm text-slate-900 focus:border-brand-500 focus:outline-none"
            />
            {ui.showSlug && (
              <>
                <label htmlFor={ui.slugInputId} className="text-sm font-medium text-slate-600">
                  Slug
                </label>
                <input
                  id={ui.slugInputId}
                  type="text"
                  value={slug ?? ''}
                  onChange={(event) => setSlug?.(event.target.value)}
                  placeholder={ui.slugPlaceholder}
                  className="w-48 rounded border border-slate-300 px-3 py-1 text-sm text-slate-900 focus:border-brand-500 focus:outline-none"
                />
              </>
            )}
            <button
              type="submit"
              disabled={saveDisabled}
              className="rounded bg-brand-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {isSaving ? 'Guardando…' : 'Guardar'}
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              void handlePublish();
            }}
            disabled={publishDisabled}
            className="rounded border border-brand-200 bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700 transition hover:bg-brand-100 disabled:opacity-50"
          >
            {ui.publishButtonLabel(Boolean(published))}
          </button>
          <span
            role="status"
            aria-live="polite"
            className={`text-sm ${status === 'error' ? 'text-red-600' : status === 'success' ? 'text-green-600' : 'text-slate-500'}`}
          >
            {statusText}
          </span>
          {friendlyUrl !== null && (
            <a
              href={friendlyUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-brand-600 underline hover:text-brand-700"
            >
              {friendlyUrl}
            </a>
          )}
        </div>

        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center">
            <p className="text-lg font-semibold text-slate-700">{ui.emptyStateTitle}</p>
            <p className="max-w-md text-sm text-slate-500">{ui.emptyStateBody}</p>
            <button
              type="button"
              onClick={handleNew}
              disabled={isSaving}
              className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {ui.emptyStateButtonLabel}
            </button>
          </div>
        ) : (
          <>
            {ui.showIdentityBar && currentIdentity !== null && (
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-2">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Editando
                </span>
                <span className="rounded bg-white px-2 py-0.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200">
                  {currentIdentity.title || 'Sin título'}
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">
                  /{currentIdentity.slug}
                </span>
                {published && (
                  <a
                    href={portalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-sm font-medium text-brand-600 underline hover:text-brand-700"
                  >
                    {portalUrl}
                  </a>
                )}
              </div>
            )}
            <EditorLayout config={config} />
          </>
        )}
      </div>
    </EditorStoreContext.Provider>
  );
}
