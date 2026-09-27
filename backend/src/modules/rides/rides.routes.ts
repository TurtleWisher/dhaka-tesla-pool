import { Router } from 'express';
import { parseBody } from '../../lib/validation.js';
import { currentUser } from '../../middleware/authenticate.js';
import { CreateRideBody } from './rides.schemas.js';
import type { RidesService } from './rides.service.js';

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

  return router;
}
