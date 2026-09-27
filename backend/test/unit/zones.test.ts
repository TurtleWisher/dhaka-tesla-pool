import { describe, expect, it } from 'vitest';
import { ZONES, ZONE_NAMES, distanceKm, distanceMetres } from '../../src/domain/zones.js';
import { Zone as DatabaseZone } from '../../src/generated/prisma/enums.js';

describe('zones and the distance table', () => {
  it('[U-MATCH-05] has exactly the zones the database knows, each with a name', () => {
    expect([...ZONES].sort()).toEqual(Object.values(DatabaseZone).sort());
    for (const zone of ZONES) {
      expect(ZONE_NAMES[zone]).toMatch(/^[A-Z][a-z]+( \d+)?$/); // "Banani", "Gulshan 1"
    }
  });

  it('[U-MATCH-05] matches the story distances', () => {
    expect(distanceKm('BANANI', 'MOHAKHALI')).toBe(3); // Nusrat
    expect(distanceKm('BANANI', 'GULSHAN_1')).toBe(4); // Rafiq and Shirin
    expect(distanceKm('MOHAKHALI', 'GULSHAN_1')).toBe(2); // Nusrat and Rafiq can pool
    expect(distanceKm('MOHAKHALI', 'GULSHAN_2')).toBe(4); // too far for Nusrat's pool
    expect(distanceMetres('BANANI', 'MOHAKHALI')).toBe(3000);
  });

  it('[U-MATCH-05] is zero from a zone to itself and positive between different zones', () => {
    for (const a of ZONES) {
      for (const b of ZONES) {
        if (a === b) expect(distanceKm(a, b)).toBe(0);
        else expect(distanceKm(a, b)).toBeGreaterThan(0);
      }
    }
  });

  it('[U-MATCH-05] is symmetric: A to B is as far as B to A', () => {
    for (const a of ZONES) {
      for (const b of ZONES) {
        expect(distanceKm(a, b)).toBe(distanceKm(b, a));
      }
    }
  });

  it('[U-MATCH-05] never has a shortcut: A to C is at most A to B plus B to C', () => {
    for (const a of ZONES) {
      for (const b of ZONES) {
        for (const c of ZONES) {
          expect(distanceKm(a, c)).toBeLessThanOrEqual(distanceKm(a, b) + distanceKm(b, c));
        }
      }
    }
  });

  it('[U-MATCH-05] refuses a zone it does not know', () => {
    expect(() => distanceKm('BANANI', 'MOTIJHEEL' as never)).toThrow(RangeError);
  });
});
