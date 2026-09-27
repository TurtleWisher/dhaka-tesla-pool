import { Router } from 'express';
import { ZONES, ZONE_NAMES } from '../../domain/zones.js';

/** Mounted at /api/v1/zones. The zone list for the pickup and drop-off dropdowns. */
export function createZonesRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ zones: ZONES.map((id) => ({ id, name: ZONE_NAMES[id] })) });
  });

  return router;
}
