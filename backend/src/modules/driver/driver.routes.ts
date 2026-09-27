import { Router } from 'express';
import { currentUser } from '../../middleware/authenticate.js';
import type { DriverService } from './driver.service.js';

/** Mounted at /api/v1/driver, behind "signed in" and "drivers only" (see app.ts). */
export function createDriverRouter(driverService: DriverService): Router {
  const router = Router();

  router.post('/online', async (req, res) => {
    res.json({ driver: await driverService.goOnline(currentUser(req).id) });
  });

  router.post('/offline', async (req, res) => {
    res.json({ driver: await driverService.goOffline(currentUser(req).id) });
  });

  return router;
}
