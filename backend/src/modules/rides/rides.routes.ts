import { Router } from 'express';
import { AppError } from '../../lib/errors.js';
import { parseBody, parseQuery } from '../../lib/validation.js';
import { currentUser } from '../../middleware/authenticate.js';
import { CreateRideBody, HistoryQuery, RideIdParam } from './rides.schemas.js';
import type { RidesService } from './rides.service.js';

/** A ride id from the URL. Not a UUID? Then it cannot be a ride: 404, like any unknown id. */
function rideIdFrom(value: string | undefined): string {
  const id = RideIdParam.safeParse(value);
  if (!id.success) {
    throw new AppError(404, 'NOT_FOUND', 'Ride not found');
  }
  return id.data;
}

/** Mounted at /api/v1/rides, behind "signed in" and "passengers only" (see app.ts). */
export function createRidesRouter(ridesService: RidesService): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const input = parseBody(CreateRideBody, req.body);
    const ride = await ridesService.create(currentUser(req).id, input);
    res.status(201).json({ ride });
  });

  router.get('/current', async (req, res) => {
    const ride = await ridesService.getCurrent(currentUser(req).id);
    res.json({ ride });
  });

  router.get('/', async (req, res) => {
    const query = parseQuery(HistoryQuery, req.query);
    res.json(await ridesService.list(currentUser(req).id, query));
  });

  // After /current, so "current" is never mistaken for a ride id.
  router.get('/:id', async (req, res) => {
    const ride = await ridesService.get(currentUser(req).id, rideIdFrom(req.params.id));
    res.json({ ride });
  });

  return router;
}
