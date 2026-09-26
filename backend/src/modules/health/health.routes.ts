import { Router } from 'express';

export const healthRouter = Router();

// Liveness check used by Docker and the deployment platform.
// Once the database is added, this will also check the database connection.
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
