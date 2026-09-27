import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config/env.js';
import type { PrismaClient } from './lib/prisma.js';
import { authenticate, requireRole } from './middleware/authenticate.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { originCheck } from './middleware/originCheck.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createFaresRouter } from './modules/fares/fares.routes.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createRidesRouter } from './modules/rides/rides.routes.js';
import { createRidesService } from './modules/rides/rides.service.js';
import { createZonesRouter } from './modules/zones/zones.routes.js';

/** Everything the app needs from the outside world, passed in so tests can supply their own. */
export interface AppDependencies {
  logger: Logger;
  prisma: PrismaClient;
  config: AppConfig;
}

/**
 * Builds the Express app without starting a server.
 * Tests import this directly (Supertest), and server.ts calls listen() on it.
 */
export function createApp({ logger, prisma, config }: AppDependencies): Express {
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

  // 4. Read the Cookie header into req.cookies (the session cookie lives there).
  app.use(cookieParser());

  // 5. CSRF protection: requests that change something must come from our web app.
  app.use(originCheck(config.FRONTEND_ORIGIN));

  // 6. Routes. Who may call what is visible here, in one place.
  const signedIn = authenticate(config.JWT_SECRET);
  const passengersOnly = [signedIn, requireRole('PASSENGER')];

  app.use(createHealthRouter(prisma));
  const authService = createAuthService(prisma, config.BCRYPT_COST);
  app.use('/api/v1/auth', createAuthRouter({ authService, config }));
  app.use('/api/v1/zones', signedIn, createZonesRouter());
  app.use('/api/v1/fares', ...passengersOnly, createFaresRouter());
  app.use('/api/v1/rides', ...passengersOnly, createRidesRouter(createRidesService(prisma)));

  // 7. Nothing matched, then turn every error into a consistent JSON response.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
