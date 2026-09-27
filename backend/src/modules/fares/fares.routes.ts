import { Router } from 'express';
import { calculateFare } from '../../domain/fare.js';
import { distanceMetres } from '../../domain/zones.js';
import { parseQuery } from '../../lib/validation.js';
import { EstimateQuery } from '../rides/rides.schemas.js';

/**
 * Mounted at /api/v1/fares. Shows what a trip would cost before booking it:
 * the solo price and the price if the car is shared. Nothing is stored.
 */
export function createFaresRouter(): Router {
  const router = Router();

  router.get('/estimate', (req, res) => {
    const trip = parseQuery(EstimateQuery, req.query);
    const distanceM = distanceMetres(trip.pickupZone, trip.dropoffZone);

    res.json({
      ...trip,
      distanceM,
      solo: calculateFare({ distanceM, seats: trip.seats, pooled: false }),
      pooled: calculateFare({ distanceM, seats: trip.seats, pooled: true }),
    });
  });

  return router;
}
