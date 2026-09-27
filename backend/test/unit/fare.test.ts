import { describe, expect, it } from 'vitest';
import { calculateFare, divRoundHalfUp } from '../../src/domain/fare.js';

// Distances from the zone table: Banani → Mohakhali 3 km, Banani → Gulshan 1 4 km.
const NUSRAT = { distanceM: 3000, seats: 1 };
const RAFIQ = { distanceM: 4000, seats: 1 };

describe('fare: the worked examples from docs/architecture.md §10.3', () => {
  it('[U-FARE-01] solo: Nusrat pays ৳125, Rafiq ৳150', () => {
    expect(calculateFare({ ...NUSRAT, pooled: false })).toEqual({
      base: 5000,
      distance: 7500,
      discount: 0,
      total: 12500,
    });
    expect(calculateFare({ ...RAFIQ, pooled: false }).total).toBe(15000);
  });

  it('[U-FARE-02] pooled: Nusrat pays ৳100, Rafiq ৳120 (20% off)', () => {
    expect(calculateFare({ ...NUSRAT, pooled: true })).toEqual({
      base: 5000,
      distance: 7500,
      discount: 2500,
      total: 10000,
    });
    expect(calculateFare({ ...RAFIQ, pooled: true })).toEqual({
      base: 5000,
      distance: 10000,
      discount: 3000,
      total: 12000,
    });
  });

  it('[U-FARE-03] multi-seat: fares are per seat, so Rafiq with 2 seats pays ৳240 pooled', () => {
    expect(calculateFare({ distanceM: 4000, seats: 2, pooled: true })).toEqual({
      base: 10000,
      distance: 20000,
      discount: 6000,
      total: 24000,
    });
    // One request with 2 seats is not a pool by itself: no discount unless another request shares.
    expect(calculateFare({ distanceM: 4000, seats: 2, pooled: false }).total).toBe(30000);
  });
});

describe('fare: rounding and safety', () => {
  it('[U-FARE-04] divRoundHalfUp rounds to the nearest whole number, halves up', () => {
    expect(divRoundHalfUp(0, 7)).toBe(0);
    expect(divRoundHalfUp(4, 10)).toBe(0); // 0.4
    expect(divRoundHalfUp(5, 10)).toBe(1); // 0.5, a half: up
    expect(divRoundHalfUp(14, 10)).toBe(1); // 1.4
    expect(divRoundHalfUp(15, 10)).toBe(2); // 1.5, a half: up
    expect(divRoundHalfUp(20, 10)).toBe(2); // exact
  });

  it('[U-FARE-04] rounds a distance that is not a whole kilometre to the nearest poysha', () => {
    // 3.333 km × ৳25 = ৳83.325, i.e. 8332.5 poysha: an exact half, so it rounds up to 8333.
    expect(calculateFare({ distanceM: 3333, seats: 1, pooled: false }).distance).toBe(8333);
    // 3.5 km × ৳25 = 8750 poysha exactly.
    expect(calculateFare({ distanceM: 3500, seats: 1, pooled: false }).distance).toBe(8750);
  });

  it('[U-FARE-04] refuses negative, zero and fractional inputs', () => {
    expect(() => divRoundHalfUp(-1, 10)).toThrow(RangeError);
    expect(() => divRoundHalfUp(1, 0)).toThrow(RangeError);
    expect(() => divRoundHalfUp(1.5, 10)).toThrow(RangeError);
    expect(() => calculateFare({ distanceM: 0, seats: 1, pooled: false })).toThrow(/distanceM/);
    expect(() => calculateFare({ distanceM: 3000, seats: 0, pooled: false })).toThrow(/seats/);
    expect(() => calculateFare({ distanceM: 3000.5, seats: 1, pooled: false })).toThrow(/distanceM/);
    expect(() => calculateFare({ distanceM: 3000, seats: 1.5, pooled: false })).toThrow(/seats/);
  });

  it('[U-FARE-04] always adds up, is never negative and the discount never exceeds 20%', () => {
    for (let distanceM = 1; distanceM <= 20_000; distanceM += 37) {
      for (const seats of [1, 2, 3]) {
        for (const pooled of [false, true]) {
          const fare = calculateFare({ distanceM, seats, pooled });
          expect(fare.total).toBe(fare.base + fare.distance - fare.discount);
          expect(Object.values(fare).every((part) => Number.isInteger(part) && part >= 0)).toBe(true);
          expect(fare.discount * 5).toBeLessThanOrEqual(fare.base + fare.distance + 2); // 20%, ±rounding
          if (!pooled) expect(fare.discount).toBe(0);
        }
      }
    }
  });
});
