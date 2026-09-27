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
