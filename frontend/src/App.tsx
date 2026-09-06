/**
 * Componente raíz de la aplicación.
 *
 * Contrato:
 * - Recibe la configuración validada por inyección de dependencias.
 * - Muestra una cabecera con navegación persistente por áreas y el configurador
 *   unificado del sitio (landing + páginas del portal) como vista por defecto.
 * - La navegación sitúa la pestaña de configuración al FINAL de todas las
 *   pestañas en todos los perfiles: Sitio (construir el sitio) → Captación
 *   (atraer tráfico) → Operación del bot (operar leads/campañas) → Dominios
 *   (dominios personalizados) → Usuarios/Tenants (control plane) →
 *   Configuración (ajustes técnicos) → Mi perfil.
 * - Cada área es un botón persistente con etiqueta estable: la activa se resalta
 *   y el resto permanece visible, de modo que nunca hay que "volver al editor"
 *   mediante un botón genérico: se navega directamente a la sección deseada.
 * - Cada área se muestra solo si su feature está habilitada (fail-closed).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { IAppConfig } from '@/types/config';
import { AdsSection } from '@/components/Ads/AdsSection';
import { DominiosSection } from '@/components/Dominios/DominiosSection';
import { OperationsArea } from '@/components/Operations/OperationsArea';
import { SiteEditor } from '@/components/Editor/SiteEditor';
import { TenantConfigSettings } from '@/components/Settings/TenantConfigSettings';
import { TenantsSection } from '@/components/Tenants/TenantsSection';
import { LoginScreen } from '@/components/Auth/LoginScreen';
import { ProfileSection } from '@/components/Profile/ProfileSection';
import { UsersSection } from '@/components/Users/UsersSection';
import { useEditorStore } from '@/store/editorStore';
import { useEditorStoreContext } from '@/store/editorStoreContext';
import { usePortalStore } from '@/store/portalStore';
import { useTenantStore } from '@/store/tenantStore';
import { useAdsStore } from '@/store/adsStore';
import { useHostsStore } from '@/store/hostsStore';
import { useAuthStore } from '@/store/authStore';
import { canAccessArea, type RbacArea } from '@/lib/rbac';

interface IAppProps {
  /** Configuración validada de la aplicación. */
  config: IAppConfig;
}

/** Vista activa de la aplicación. */
type AppView =
  'editor' | 'ads' | 'operations' | 'settings' | 'hosts' | 'users' | 'tenants' | 'profile';

/** Entrada de navegación persistente de la cabecera. */
interface INavItem {
  /** Vista a la que navega. */
  view: AppView;
  /** Etiqueta estable del botón. */
  label: string;
  /** Título del área mostrado como subtítulo. */
  subtitle: string;
  /** Mensaje de accesibilidad al activar el área. */
  announcement: string;
  /** Área funcional RBAC que protege la entrada (si no se indica, siempre visible). */
  area?: RbacArea;
}

/**
 * Componente raíz de OmniBotIA Studio.
 *
 * @example
 * ```tsx
 * import { createTestConfig } from '@/test/config';
 *
 * <App config={createTestConfig()} />;
 * ```
 *
 * @param props - Propiedades del componente.
 * @returns La aplicación renderizada con cabecera y editor o configurador.
 */
export default function App({ config }: IAppProps): ReactElement {
  const editorStore = useEditorStoreContext();
  const landingTitle = editorStore((state) => state.landing.title);
  // Título del portal (cuando se está editando una página del portal, la cabecera
  // debe reflejar esa página y no la landing por defecto del store de arranque).
  const portalPageId = usePortalStore((state) => state.pageId);
  const portalTitle = usePortalStore((state) => state.landing.title);
  const siteTitle =
    portalPageId !== null && portalPageId !== undefined ? portalTitle : landingTitle;
  const [view, setView] = useState<AppView>('editor');
  const settingsEnabled = config.features.appearance;
  const operationsEnabled = config.features.operations;
  const adsEnabled = config.features.ads;
  const hostsEnabled = config.features.hosts;

  // Selector de tenant en runtime (FASE D — GAP-5): al montar se cargan los
  // tenants disponibles (control plane) y se preselecciona el activo. Cambiar la
  // selección fija el tenant activo para todas las llamadas posteriores.
  const tenants = useTenantStore((state) => state.tenants);
  const activeTenantId = useTenantStore((state) => state.activeTenantId);
  const tenantStatus = useTenantStore((state) => state.status);
  const tenantError = useTenantStore((state) => state.error);
  const loadTenants = useTenantStore((state) => state.loadTenants);
  const setActiveTenant = useTenantStore((state) => state.setActiveTenant);

  // Estado de autenticación y RBAC (FASE RBAC): la sesión se restaura al montar
  // consultando `me` + membresías; el rol activo es por tenant y se recalcula al
  // cambiar de tenant. La navegación se filtra por rol (fail-closed).
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const authStatus = useAuthStore((state) => state.status);
  const activeRole = useAuthStore((state) => state.activeRole);
  const isSuperAdmin = useAuthStore((state) => state.isSuperAdmin);
  const loadMe = useAuthStore((state) => state.loadMe);
  const logout = useAuthStore((state) => state.logout);
  const setActiveTenantRole = useAuthStore((state) => state.setActiveTenantRole);

  // Contexto RBAC evaluado por la UI para filtrar navegación y ocultar áreas.
  const rbacContext = { role: activeRole, isSuperAdmin };

  // Carga la lista de tenants (control plane) al montar. El endpoint exige
  // autenticación, así que si el usuario aún no ha iniciado sesión la primera
  // llamada devuelve 401 y `tenants` queda vacío. Por eso se vuelve a cargar
  // cuando la autenticación pasa a `true` (tras login o restauración de sesión),
  // garantizando que el selector de tenant se renderice para cualquier usuario
  // autenticado (admin/configurador/operador).
  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    if (isAuthenticated) {
      void loadTenants();
    }
  }, [isAuthenticated, loadTenants]);

  // Restaura la sesión al arrancar (si hay token persistido) y la REINTENTA al
  // pasar de autenticado a no-autenticado (logout): el token ya no es válido en
  // el backend, la restauración falla y la puerta muestra la pantalla de login
  // (en lugar de quedarse en «Cargando…»). En pruebas se siembra
  // `isAuthenticated` directamente, por lo que `loadMe` sin servicio no rompe la UI.
  useEffect(() => {
    if (!isAuthenticated) {
      void loadMe();
    }
  }, [isAuthenticated, loadMe]);

  // Tenant visible: el activo en runtime si ya se cargó; en caso contrario se
  // degrada al tenant de arranque (configuración) para no romper la UI.
  const displayedTenantId = activeTenantId ?? config.tenantId;
  const hasTenantOptions = tenants.length > 0;

  // Aislamiento entre tenants: los stores globales del editor/portal persisten su
  // configuración en `localStorage` bajo claves fijas (`omnibotia-editor`,
  // `omnibotia-portal`) sin separar por tenant. Al cambiar de tenant se reinician
  // para que el canvas no muestre (ni llegue a guardar) la landing/portal del
  // tenant anterior. Se ignora el primer render para no borrar el borrador del
  // tenant de arranque al montar la aplicación.
  const previousTenantRef = useRef(displayedTenantId);
  useEffect(() => {
    const previous = previousTenantRef.current;
    previousTenantRef.current = displayedTenantId;
    if (previous !== displayedTenantId) {
      useEditorStore.getState().reset();
      usePortalStore.getState().reset();
      // Los stores de captación (ads) y dominios (hosts) también son globales y
      // guardan datos del tenant activo en memoria; se reinician al cambiar de
      // tenant para evitar fugas transitorias entre tenants.
      useAdsStore.getState().reset();
      useHostsStore.getState().reset();
    }
  }, [displayedTenantId]);

  // Navegación persistente: primero se construye el sitio y se opera el flujo
  // comercial (Captación / Operación), y la configuración técnica se sitúa al
  // FINAL de todas las pestañas en todos los perfiles (las áreas de Dominios y
  // Usuarios preceden a «Configuración», que es la última área funcional antes
  // de «Mi perfil»). Cada entrada declara su área funcional RBAC; se filtra con
  // `canAccessArea` (fail-closed: sin rol → sin acceso). «Usuarios» (control
  // plane) y «Mi perfil» se añaden al final del flujo.
  const allNavItems: INavItem[] = [
    {
      view: 'editor',
      label: 'Sitio',
      subtitle: `Sitio: ${siteTitle}`,
      announcement: 'Editor del sitio abierto',
      area: 'content',
    },
    ...(adsEnabled
      ? [
          {
            view: 'ads' as AppView,
            label: 'Captación',
            subtitle: 'Captación publicitaria',
            announcement: 'Captación publicitaria abierta',
            area: 'operations' as RbacArea,
          },
        ]
      : []),
    ...(operationsEnabled
      ? [
          {
            view: 'operations' as AppView,
            label: 'Operación del bot',
            subtitle: 'Operación del bot',
            announcement: 'Operación del bot abierta',
            area: 'operations' as RbacArea,
          },
        ]
      : []),
    ...(hostsEnabled
      ? [
          {
            view: 'hosts' as AppView,
            label: 'Dominios',
            subtitle: 'Dominios personalizados',
            announcement: 'Dominios personalizados abierta',
            area: 'tenantConfig' as RbacArea,
          },
        ]
      : []),
    ...(canAccessArea('platformUsers', rbacContext)
      ? [
          {
            view: 'users' as AppView,
            label: 'Usuarios',
            subtitle: 'Usuarios de la plataforma',
            announcement: 'Usuarios de la plataforma abierta',
            area: 'platformUsers' as RbacArea,
          },
        ]
      : []),
    ...(canAccessArea('platformUsers', rbacContext)
      ? [
          {
            view: 'tenants' as AppView,
            label: 'Tenants',
            subtitle: 'Gestión de tenants (control plane)',
            announcement: 'Gestión de tenants abierta',
            area: 'platformUsers' as RbacArea,
          },
        ]
      : []),
    ...(settingsEnabled
      ? [
          {
            view: 'settings' as AppView,
            label: 'Configuración',
            subtitle: 'Configuración del bot',
            announcement: 'Configuración del bot abierta',
            area: 'tenantConfig' as RbacArea,
          },
        ]
      : []),
    {
      view: 'profile',
      label: 'Mi perfil',
      subtitle: 'Mi perfil',
      announcement: 'Mi perfil abierto',
      area: 'profile',
    },
  ];

  // Se filtran las entradas por su área funcional RBAC (fail-closed: sin rol → sin
  // acceso). Las entradas sin `area` (ninguna hoy) siempre se muestran.
  const navItems = allNavItems.filter((item) =>
    item.area ? canAccessArea(item.area, rbacContext) : true,
  );

  const activeNav = navItems.find((item) => item.view === view) ?? navItems[0];

  const navigate = (next: AppView): void => {
    setView(next);
  };

  // Puerta de autenticación (FASE RBAC): sin sesión válida se muestra la pantalla
  // de inicio de sesión. Mientras se restaura la sesión (o antes de decidir) se
  // muestra una pantalla de carga para evitar un parpadeo de la pantalla de login.
  if (!isAuthenticated) {
    if (authStatus === 'loading' || authStatus === 'idle') {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
          Cargando…
        </div>
      );
    }
    return <LoginScreen />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">{config.appName}</h1>
          <div className="flex items-center gap-3 text-sm">
            <nav aria-label="Áreas de la aplicación" className="flex items-center gap-1">
              {navItems.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => navigate(item.view)}
                  aria-pressed={view === item.view}
                  aria-current={view === item.view ? 'page' : undefined}
                  className={
                    view === item.view
                      ? 'rounded border border-brand-400 bg-brand-600 px-3 py-1 font-medium text-white transition hover:bg-brand-700'
                      : 'rounded border border-brand-200 bg-brand-50 px-3 py-1 font-medium text-brand-700 transition hover:bg-brand-100'
                  }
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <span className="rounded-full bg-brand-100 px-3 py-1 font-medium text-brand-700">
              {config.appEnv}
            </span>
            <div className="flex items-center gap-2">
              {/* Selector de tenant: siempre en la parte superior derecha para
                  TODOS los perfiles (la lista se carga al autenticarse). La
                  gestión de tenants (crear/renombrar/eliminar) vive en su propia
                  pestaña «Tenants» (control plane, super-admin). */}
              <label
                htmlFor="tenant-select"
                className="text-xs font-medium uppercase tracking-wide text-slate-500"
              >
                Tenant
              </label>
              {hasTenantOptions ? (
                <select
                  id="tenant-select"
                  value={displayedTenantId}
                  onChange={(event) => {
                    // Al cambiar de tenant se fija el tenant activo (para las
                    // llamadas posteriores) y se recalcula el rol activo desde las
                    // membresías (el rol es por tenant).
                    setActiveTenant(event.target.value);
                    setActiveTenantRole(event.target.value);
                  }}
                  aria-label="Tenant activo"
                  title="El contenido mostrado y editado pertenece al tenant seleccionado."
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                >
                  {tenants.map((tenant) => (
                    <option key={tenant.slug} value={tenant.slug}>
                      {tenant.name || tenant.slug}
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  className="rounded-full bg-slate-100 px-3 py-1 text-slate-600"
                  title={
                    tenantStatus === 'error' && tenantError
                      ? `No se pudieron cargar los tenants: ${tenantError}`
                      : 'El contenido mostrado y editado pertenece al tenant seleccionado.'
                  }
                >
                  {displayedTenantId}
                </span>
              )}
              {/* Cierre de sesión persistente (todos los perfiles): permite salir
                  para entrar con otro usuario o perfil. */}
              <button
                type="button"
                onClick={() => {
                  void logout();
                }}
                aria-label="Cerrar sesión"
                title="Cerrar sesión para entrar con otro usuario o perfil."
                className="rounded border border-slate-200 bg-white px-3 py-1 font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Salir
              </button>
            </div>
          </div>
        </div>
        {/* Un usuario autenticado sin membresía ni rol por tenant no tiene áreas
            accesibles (fail-closed), por lo que `navItems` puede quedar vacío y
            `activeNav` indefinido; se omite el subtítulo/aviso en ese caso. */}
        {activeNav ? (
          <>
            <p className="mt-1 text-sm text-slate-400">{activeNav.subtitle}</p>
            <span role="status" aria-live="polite" className="sr-only">
              {activeNav.announcement}
            </span>
          </>
        ) : null}
      </header>
      {/* key={displayedTenantId}: al cambiar de tenant se fuerza el remontaje de la
          sección activa para que recargue sus datos (landings, portal, ads, etc.)
          para el tenant recién seleccionado. Sin esto, los componentes cargan sus
          listas solo al montar y quedan obsoletos al cambiar de tenant. */}
      <div key={displayedTenantId} className="flex flex-1 flex-col overflow-hidden">
        {view === 'ads' ? (
          <AdsSection />
        ) : view === 'operations' ? (
          <OperationsArea config={config} />
        ) : view === 'settings' ? (
          <TenantConfigSettings config={config} />
        ) : view === 'hosts' ? (
          <DominiosSection config={config} />
        ) : view === 'users' ? (
          <UsersSection />
        ) : view === 'tenants' ? (
          <TenantsSection />
        ) : view === 'profile' ? (
          <ProfileSection />
        ) : (
          <SiteEditor config={config} />
        )}
      </div>
    </div>
  );
}
