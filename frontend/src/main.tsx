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
import { createWorkflowService } from '@/services/workflowService';
import { setAiService } from '@/store/aiStore';
import { setAnalyticsService } from '@/store/analyticsStore';
import { setCdnService } from '@/store/cdnStore';
import { setCompilerService } from '@/store/compilerStore';
import { setMarketplaceService } from '@/store/marketplaceStore';
import { setSchemaService } from '@/store/schemaStore';
import { setWorkflowService } from '@/store/workflowStore';
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
