/**
 * The fare rules (docs/architecture.md §10, A-29). Pure: no database, no Express.
 * Every amount is an integer number of poysha (1 taka = 100 poysha), so there is never
 * a rounding error like 0.1 + 0.2 = 0.30000000000000004.
 */

/** ৳50 per seat. */
export const BASE_FARE_POYSHA = 5000;
/** ৳25 per kilometre, per seat. */
export const RATE_PER_KM_POYSHA = 2500;
/** 20% off when the trip is shared, in basis points (1 bp = 0.01%). */
export const POOL_DISCOUNT_BPS = 2000;

/** The four parts of a fare. Always: total = base + distance - discount. */
export interface FareBreakdown {
  base: number;
  distance: number;
  discount: number;
  total: number;
}

export interface FareInput {
  /** Trip length in metres (from the zone table). */
  distanceM: number;
  /** Seats booked by this one request (1 to 3). */
  seats: number;
  /** True when at least two different requests share the car. */
  pooled: boolean;
}

/** Throws unless `value` is a whole number of at least `min`. */
function requireInteger(name: string, value: number, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${name} must be a whole number of at least ${min}, got ${value}`);
  }
}

/**
 * n / d rounded to the nearest whole number, with exact halves rounded up,
 * using integers only: floor((2n + d) / (2d)). Example: 5 / 10 = 0.5, rounds to 1.
 */
export function divRoundHalfUp(n: number, d: number): number {
  requireInteger('n', n, 0);
  requireInteger('d', d, 1);
  return Math.floor((2 * n + d) / (2 * d));
}

/** Calculates one request's fare. Fares are charged per seat. */
export function calculateFare({ distanceM, seats, pooled }: FareInput): FareBreakdown {
  requireInteger('distanceM', distanceM, 1);
  requireInteger('seats', seats, 1);

  const distancePerSeat = divRoundHalfUp(distanceM * RATE_PER_KM_POYSHA, 1000);
  const base = BASE_FARE_POYSHA * seats;
  const distance = distancePerSeat * seats;
  const subtotal = base + distance;
  const discount = pooled ? divRoundHalfUp(subtotal * POOL_DISCOUNT_BPS, 10_000) : 0;

  return { base, distance, discount, total: subtotal - discount };
}
