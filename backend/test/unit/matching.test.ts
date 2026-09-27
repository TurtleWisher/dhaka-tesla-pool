import { describe, expect, it } from 'vitest';
import { type CandidatePool, MAX_DROPOFF_SPREAD_KM, canJoin } from '../../src/domain/matching.js';

// The story: Jashim's pool on Bullet picks up in Banani. Nusrat is going to Mohakhali.
const withNusrat: CandidatePool = {
  status: 'ACCEPTED',
  pickupZone: 'BANANI',
  seatsAvailable: 2,
  memberDropoffZones: ['MOHAKHALI'],
};
const rafiq = { pickupZone: 'BANANI', dropoffZone: 'GULSHAN_1', seats: 1 } as const;
const toGulshan2 = { pickupZone: 'BANANI', dropoffZone: 'GULSHAN_2', seats: 1 } as const;

describe('canJoin: the pooling rule (docs/architecture.md §9.2)', () => {
  it('[U-MATCH-01] lets Rafiq join Nusrat: same pickup, a free seat, drop-offs 2 km apart', () => {
    expect(canJoin(rafiq, withNusrat)).toBe(true);
    // Shirin, also to Gulshan 1, then fits with both of them (2 km and 0 km).
    expect(
      canJoin(rafiq, { ...withNusrat, seatsAvailable: 1, memberDropoffZones: ['MOHAKHALI', 'GULSHAN_1'] }),
    ).toBe(true);
  });

  it('[U-MATCH-02] refuses a request from a different pickup zone', () => {
    expect(canJoin({ ...rafiq, pickupZone: 'MOHAKHALI' }, withNusrat)).toBe(false);
  });

  it('[U-MATCH-03] Banani → Gulshan 2 joins {Rafiq} but not {Nusrat, Rafiq}: EVERY rider must be close', () => {
    const withRafiq = { ...withNusrat, memberDropoffZones: ['GULSHAN_1'] } as const;
    const withBoth = { ...withNusrat, seatsAvailable: 1, memberDropoffZones: ['MOHAKHALI', 'GULSHAN_1'] } as const;

    expect(canJoin(toGulshan2, withRafiq)).toBe(true); // Gulshan 1 ↔ Gulshan 2 = 2 km
    expect(canJoin(toGulshan2, withBoth)).toBe(false); // Mohakhali ↔ Gulshan 2 = 4 km
  });

  it('[U-MATCH-03] allows exactly 3 km and refuses 4 km', () => {
    expect(MAX_DROPOFF_SPREAD_KM).toBe(3);
    const fromGulshan2 = { ...withNusrat, pickupZone: 'GULSHAN_2', memberDropoffZones: ['BANANI'] } as const;

    expect(canJoin({ pickupZone: 'GULSHAN_2', dropoffZone: 'MOHAKHALI', seats: 1 }, fromGulshan2)).toBe(true); // 3 km
    expect(canJoin({ pickupZone: 'GULSHAN_2', dropoffZone: 'GULSHAN_1', seats: 1 }, fromGulshan2)).toBe(false); // 4 km
  });

  it('[U-MATCH-04] needs enough free seats: Rafiq with 2 seats fits 2, not 1', () => {
    const twoSeats = { ...rafiq, seats: 2 };

    expect(canJoin(twoSeats, withNusrat)).toBe(true);
    expect(canJoin(twoSeats, { ...withNusrat, seatsAvailable: 1 })).toBe(false);
  });

  it('[U-MATCH-04] only an ACCEPTED pool takes new riders: the roster locks when the driver arrives', () => {
    for (const status of ['DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED'] as const) {
      expect(canJoin(rafiq, { ...withNusrat, status }), status).toBe(false);
    }
  });
});
