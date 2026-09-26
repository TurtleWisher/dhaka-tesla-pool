import { Router } from 'express';
import type { PrismaClient } from '../../lib/prisma.js';

/**
 * Health check used by Docker and the deployment platform.
 * 200 when the API and the database both respond; 503 ("service unavailable") when the
 * database does not, so the platform knows this instance cannot serve requests.
 */
export function createHealthRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/health', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'ok' });
    } catch (err) {
      req.log.warn({ err }, 'health check: database unreachable');
      res.status(503).json({ status: 'error', database: 'unreachable' });
    }
  });

  return router;
}
