import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/lib/logger.js';
import type { PrismaClient } from '../../src/lib/prisma.js';

/** Settings for tests: fast bcrypt, a fixed secret and a generous rate limit. */
export const testConfig: AppConfig = {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-only-secret-that-is-at-least-32-chars',
  FRONTEND_ORIGIN: 'http://localhost:3000',
  BCRYPT_COST: 4,
  AUTH_RATE_LIMIT_MAX: 1000,
};

/** The Origin header our web app sends. POST requests in tests must include it. */
export const ORIGIN = testConfig.FRONTEND_ORIGIN;

/** Builds the real app with a silent logger; `overrides` changes single settings. */
export function createTestApp(prisma: PrismaClient, overrides: Partial<AppConfig> = {}): Express {
  return createApp({
    logger: createLogger('silent'),
    prisma,
    config: { ...testConfig, ...overrides },
  });
}
