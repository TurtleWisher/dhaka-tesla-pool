import { Router } from 'express';
import { AppError } from '../../lib/errors.js';
import { currentUser } from '../../middleware/authenticate.js';
import { RideIdParam } from '../rides/rides.schemas.js';
import type { DriverService } from './driver.service.js';

/** A ride request id from the URL. Not a UUID? Then it cannot be a request: 404. */
function requestIdFrom(value: string | undefined): string {
  const id = RideIdParam.safeParse(value);
  if (!id.success) {
    throw new AppError(404, 'NOT_FOUND', 'Ride request not found');
  }
  return id.data;
}

/** Mounted at /api/v1/driver, behind "signed in" and "drivers only" (see app.ts). */
export function createDriverRouter(driverService: DriverService): Router {
  const router = Router();

  router.post('/online', async (req, res) => {
    res.json({ driver: await driverService.goOnline(currentUser(req).id) });
  });

  router.post('/offline', async (req, res) => {
    res.json({ driver: await driverService.goOffline(currentUser(req).id) });
  });

  router.get('/requests', async (req, res) => {
    res.json({ requests: await driverService.listRequests(currentUser(req).id) });
  });

  router.post('/requests/:id/accept', async (req, res) => {
    const pool = await driverService.accept(currentUser(req).id, requestIdFrom(req.params.id));
    res.json({ pool });
  });

  return router;
}
