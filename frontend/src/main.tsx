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
import { Config, ViteEnvConfigSource } from '@/lib/config';
import { ConsoleLogger } from '@/lib/logger';
import '@/index.css';

const logger = new ConsoleLogger();
const config = new Config(new ViteEnvConfigSource(), logger).load();

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
