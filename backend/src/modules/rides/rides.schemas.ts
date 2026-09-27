import { z } from 'zod';
import { ZONES } from '../../domain/zones.js';

/** One of the 9 zones, e.g. "BANANI". Anything else ("MOTIJHEEL") is a 400. */
export const ZoneSchema = z.enum(ZONES, { error: 'Choose one of the 9 zones' });

const SEATS = 'Choose 1 to 3 seats';
const SAME_ZONE = 'Drop-off must be different from pickup';

/** GET /fares/estimate?pickup=BANANI&dropoff=MOHAKHALI&seats=1 (query values arrive as text). */
export const EstimateQuery = z
  .object({
    pickup: ZoneSchema,
    dropoff: ZoneSchema,
    // "2" in the URL becomes the number 2; seats is optional here and defaults to 1.
    seats: z.coerce.number({ error: SEATS }).int(SEATS).min(1, SEATS).max(3, SEATS).default(1),
  })
  .refine((q) => q.pickup !== q.dropoff, { message: SAME_ZONE, path: ['dropoff'] })
  .transform((q) => ({ pickupZone: q.pickup, dropoffZone: q.dropoff, seats: q.seats }));
export type EstimateInput = z.infer<typeof EstimateQuery>;

/** POST /rides: what a passenger sends to request a ride. */
export const CreateRideBody = z
  .object({
    pickupZone: ZoneSchema,
    dropoffZone: ZoneSchema,
    seats: z.number({ error: SEATS }).int(SEATS).min(1, SEATS).max(3, SEATS).default(1),
  })
  .refine((ride) => ride.pickupZone !== ride.dropoffZone, { message: SAME_ZONE, path: ['dropoffZone'] });
export type CreateRideInput = z.infer<typeof CreateRideBody>;

/** GET /rides?limit=20&cursor=<ride id>: one page of the passenger's history, newest first. */
export const HistoryQuery = z.object({
  limit: z.coerce
    .number({ error: 'limit must be 1 to 50' })
    .int('limit must be 1 to 50')
    .min(1, 'limit must be 1 to 50')
    .max(50, 'limit must be 1 to 50')
    .default(20),
  // The id of the last ride on the previous page (the `nextCursor` it returned).
  cursor: z.uuid('cursor must be a nextCursor value from a previous page').optional(),
});
export type HistoryInput = z.infer<typeof HistoryQuery>;

/** A ride id in the URL. Anything that is not a UUID cannot be a ride, so it is a 404. */
export const RideIdParam = z.uuid();
