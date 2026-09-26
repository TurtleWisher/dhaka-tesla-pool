import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const app = createApp(logger);

const server = app.listen(env.PORT, (error?: Error) => {
  if (error) {
    logger.fatal({ err: error }, 'could not start server');
    process.exit(1);
  }
  logger.info({ port: env.PORT }, 'Dhaka Tesla Pool API listening');
});

// Graceful shutdown: stop accepting new requests and let in-flight ones finish
// (Docker sends SIGTERM when a container is stopped; Ctrl+C sends SIGINT).
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
  });
}
