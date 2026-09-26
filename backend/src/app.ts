import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { PrismaClient } from './lib/prisma.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { createHealthRouter } from './modules/health/health.routes.js';

/** Everything the app needs from the outside world, passed in so tests can supply their own. */
export interface AppDependencies {
  logger: Logger;
  prisma: PrismaClient;
}

/**
 * Builds the Express app without starting a server.
 * Tests import this directly (Supertest), and server.ts calls listen() on it.
 */
export function createApp({ logger, prisma }: AppDependencies): Express {
  const app = express();

  // 1. Give every request an id and log it (the id is also returned as a header for debugging).
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    }),
  );

  // 2. Standard security headers.
  app.use(helmet());

  // 3. Parse JSON bodies, refusing anything suspiciously large.
  app.use(express.json({ limit: '10kb' }));

  // 4. Routes.
  app.use(createHealthRouter(prisma));

  // 5. Nothing matched, then turn every error into a consistent JSON response.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
