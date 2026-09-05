/**
 * Punto de entrada de OmniBotIA Studio.
 *
 * Contrato:
 * - Composition root: se ensamblan las dependencias inyectadas (logger y configuración).
 * - Valida la configuración al arranque antes de renderizar la aplicación.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { HttpApiClient } from '@/api/client';
import { Config, ViteEnvConfigSource } from '@/lib/config';
import { ConsoleLogger } from '@/lib/logger';
import { createAiService } from '@/services/aiService';
import { createAnalyticsService } from '@/services/analyticsService';
import { createCdnService } from '@/services/cdnService';
import { createCompilerService } from '@/services/compilerService';
import { createMarketplaceService } from '@/services/marketplaceService';
import { createSchemaService } from '@/services/schemaService';
import { createTenantConfigService } from '@/services/tenantConfigService';
import { createBotService } from '@/services/botService';
import { createWorkflowService } from '@/services/workflowService';
import { createOperationsService } from '@/services/operationsService';
import { createAdsService } from '@/services/adsService';
import { createCrmService } from '@/services/crmService';
import { createPseoHostService } from '@/services/hostsService';
import { createPortalService } from '@/services/portalService';
import { createLandingService } from '@/services/landingService';
import { createTenantService } from '@/services/tenantService';
import { createAuthService } from '@/services/studioAuthService';
import { createUserService } from '@/services/studioUserService';
import { createMembershipService } from '@/services/studioMembershipService';
import { setAiService } from '@/store/aiStore';
import { setAuthService } from '@/store/authStore';
import { setUserService } from '@/store/userStore';
import { setMembershipService } from '@/store/membershipStore';
import { setAnalyticsService } from '@/store/analyticsStore';
import { setCdnService } from '@/store/cdnStore';
import { setCompilerService } from '@/store/compilerStore';
import { setMarketplaceService } from '@/store/marketplaceStore';
import { setSchemaService } from '@/store/schemaStore';
import { setTenantConfigService } from '@/store/tenantConfigStore';
import { setBotService } from '@/store/botStore';
import { setWorkflowService } from '@/store/workflowStore';
import { setOperationsService } from '@/store/operationsStore';
import { setAdsService } from '@/store/adsStore';
import { setCrmService } from '@/store/crmStore';
import { setPseoHostService } from '@/store/hostsStore';
import { setPortalService } from '@/store/portalStore';
import { setLandingService } from '@/store/editorStore';
import { setTenantService } from '@/store/tenantStore';
import { setActiveTenant } from '@/lib/tenantContext';
import '@/index.css';

const logger = new ConsoleLogger();
const config = new Config(new ViteEnvConfigSource(), logger).load();

// Composition root: el cliente HTTP se ensambla de forma incondicional porque
// lo comparten el asistente IA (por feature flag) y el compilador (siempre).
const apiClient = HttpApiClient.fromConfig(config, undefined, logger);

// Composition root del asistente IA: se inyecta la implementación real solo
// cuando la bandera `aiAssistant` está activa (regla CLAUDE: DI y feature flags).
if (config.features.aiAssistant) {
  setAiService(createAiService(apiClient, logger));
}

// Composition root del compilador: se inyecta la implementación real siempre
// (la vista previa y la descarga dependen de la compilación, no de banderas).
setCompilerService(createCompilerService(apiClient, logger));

// Composition root de workflows: se inyecta la implementación real siempre
// (los workflows de conversión forman parte del editor, no dependen de banderas).
setWorkflowService(createWorkflowService(apiClient, logger));

// Composition root del editor de schemas: se inyecta la implementación real siempre
// (listar schemas no requiere IA; la generación degrada de forma controlada sin API key).
setSchemaService(createSchemaService(apiClient, logger));

// Composition root del marketplace de templates: se inyecta la implementación real siempre
// (listar el catálogo no depende de banderas; la pestaña se oculta por feature flag).
setMarketplaceService(createMarketplaceService(apiClient, logger));

// Composition root del servicio de analítica: se inyecta la implementación real siempre
// (consultar el dashboard no depende de banderas; la pestaña se oculta por feature flag).
setAnalyticsService(createAnalyticsService(apiClient, logger));

// Composition root del servicio de despliegue al CDN: se inyecta la implementación real
// siempre (desplegar no depende de banderas; el panel se oculta por feature flag).
setCdnService(createCdnService(apiClient, logger));

// Composition root del servicio de configuración del tenant para el bot: se inyecta
// la implementación real solo cuando la bandera `appearance` está activa (regla CLAUDE:
// DI y feature flags; plan §11.2 apariencia del tenant).
if (config.features.appearance) {
  setTenantConfigService(createTenantConfigService(apiClient, logger));
}

// Composition root del servicio de bots (Fase 7): se inyecta la implementación real
// solo cuando la bandera `bots` está activa (regla CLAUDE: DI y feature flags;
// plan §15.3 — sección Bots/Conversaciones).
if (config.features.bots) {
  setBotService(createBotService(apiClient, logger));
}

// Composition root del servicio de operación del bot (Bloque B): se inyecta la
// implementación real solo cuando la bandera `operations` está activa (regla CLAUDE:
// DI y feature flags; plan §16 — 3ª área «Operación del Bot»).
if (config.features.operations) {
  setOperationsService(createOperationsService(apiClient, logger));
}

// Composition root del servicio de captación publicitaria (C-1): se inyecta la
// implementación real solo cuando la bandera `ads` está activa (regla CLAUDE:
// DI y feature flags; eslabón ① del ciclo comercial — campañas con atribución UTM).
if (config.features.ads) {
  setAdsService(createAdsService(apiClient, logger));
}

// Composition root del servicio CRM (P3): se inyecta la implementación real solo
// cuando la bandera `crm` está activa (regla CLAUDE: DI y feature flags; plan §16
// — sección «Ventas» con pipeline, tareas, SLA y embudo).
if (config.features.crm) {
  setCrmService(createCrmService(apiClient, logger));
}

// Composition root del servicio de dominios personalizados (PSEO hosts): se inyecta
// la implementación real solo cuando la bandera `hosts` está activa (regla CLAUDE:
// DI y feature flags; dominios personalizados para el serving público del tenant).
if (config.features.hosts) {
  setPseoHostService(createPseoHostService(apiClient, logger));
}

// Composition root del servicio de landings: se inyecta la implementación real
// siempre (el editor de landings es la vista por defecto y su selector/guardado/
// publicación dependen del backend, no de banderas).
setLandingService(createLandingService(apiClient, logger));

// Composition root del servicio de tenants (control plane): se inyecta la
// implementación real siempre para alimentar el selector de tenant en runtime
// (FASE D — GAP-5). El tenant activo inicial se siembra desde la configuración
// para que todas las llamadas posteriores usen el tenant de arranque.
setTenantService(createTenantService(apiClient, logger));
setActiveTenant({ slug: config.tenantId, id: config.tenantId });

// Composition root de autenticación y RBAC (FASE RBAC): se inyectan las
// implementaciones reales siempre. El cliente HTTP adjunta el JWT persistido y
// el tenant activo en cada petición; `loadMe` restaura la sesión al arrancar.
setAuthService(createAuthService(apiClient, logger));
setUserService(createUserService(apiClient, logger));
setMembershipService(createMembershipService(apiClient, logger));

// Composition root del servicio de páginas del Portal del Cliente: se inyecta la
// implementación real solo cuando la bandera `portal` está activa (regla CLAUDE:
// DI y feature flags; configurador único landing/portal basado en IA generativa).
if (config.features.portal) {
  setPortalService(createPortalService(apiClient, logger));
}

const container = document.getElementById('root');
if (container === null) {
  logger.error('app.bootstrap', { reason: 'root-container-missing' });
  throw new Error('No se encontró el contenedor raíz #root en el DOM.');
}

createRoot(container).render(
  <StrictMode>
    <App config={config} />
  </StrictMode>,
);
