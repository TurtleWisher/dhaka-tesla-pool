/**
 * The 9 Dhaka zones and the distances between them (docs/architecture.md §9.1, A-01).
 * Pure data and functions: no database, no Express. The same table drives fares and pooling,
 * so there is exactly one source of truth for "how far is Banani from Mohakhali".
 */

/** The zones, in the order used by the table below. Must match the database enum `Zone`. */
export const ZONES = [
  'BANANI',
  'GULSHAN_1',
  'GULSHAN_2',
  'MOHAKHALI',
  'FARMGATE',
  'DHANMONDI',
  'MIRPUR_10',
  'UTTARA',
  'BASHUNDHARA',
] as const;

export type Zone = (typeof ZONES)[number];

/** How each zone is written for people. */
export const ZONE_NAMES: Readonly<Record<Zone, string>> = {
  BANANI: 'Banani',
  GULSHAN_1: 'Gulshan 1',
  GULSHAN_2: 'Gulshan 2',
  MOHAKHALI: 'Mohakhali',
  FARMGATE: 'Farmgate',
  DHANMONDI: 'Dhanmondi',
  MIRPUR_10: 'Mirpur 10',
  UTTARA: 'Uttara',
  BASHUNDHARA: 'Bashundhara',
};

/**
 * Approximate road distances in whole kilometres. Illustrative, symmetric, not real routing.
 * Row and column order is the same as ZONES, so it reads exactly like the table in the docs.
 */
const DISTANCE_KM: readonly (readonly number[])[] = [
  //  BAN GL1 GL2 MOH FRM DHN MIR UTT BSD
  [    0,  4,  2,  3,  7, 10,  8, 13,  6 ], // Banani
  [    4,  0,  2,  2,  6,  9, 10, 15,  6 ], // Gulshan 1
  [    2,  2,  0,  4,  8, 11,  9, 13,  5 ], // Gulshan 2
  [    3,  2,  4,  0,  4,  7,  8, 14,  7 ], // Mohakhali
  [    7,  6,  8,  4,  0,  4,  6, 17, 11 ], // Farmgate
  [   10,  9, 11,  7,  4,  0,  8, 20, 14 ], // Dhanmondi
  [    8, 10,  9,  8,  6,  8,  0, 12, 12 ], // Mirpur 10
  [   13, 15, 13, 14, 17, 20, 12,  0, 10 ], // Uttara
  [    6,  6,  5,  7, 11, 14, 12, 10,  0 ], // Bashundhara
];

/** Distance between two zones in kilometres, e.g. distanceKm('BANANI', 'MOHAKHALI') === 3. */
export function distanceKm(from: Zone, to: Zone): number {
  const km = DISTANCE_KM[ZONES.indexOf(from)]?.[ZONES.indexOf(to)];
  if (km === undefined) {
    throw new RangeError(`Unknown zone pair: ${from} -> ${to}`);
  }
  return km;
}

/** The same distance in metres, the unit stored on every ride request (`distance_m`). */
export function distanceMetres(from: Zone, to: Zone): number {
  return distanceKm(from, to) * 1000;
}
