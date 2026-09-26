import bcrypt from 'bcrypt';
import type { PrismaClient } from '../lib/prisma.js';

/**
 * Demo password for every seeded account. It is printed in the README as demo credentials,
 * so it is NOT a secret and must never be reused for anything real.
 */
export const DEMO_PASSWORD = 'TeslaPool#2026';

/** The story cast from the brief. Emails use the reserved `.test` domain, which never reaches a real inbox. */
export const CAST = {
  driver: { name: 'Jashim', email: 'jashim@teslapool.test', vehicle: { name: 'Bullet', capacity: 3 } },
  passengers: [
    { name: 'Nusrat', email: 'nusrat@teslapool.test' },
    { name: 'Rafiq', email: 'rafiq@teslapool.test' },
    { name: 'Shirin', email: 'shirin@teslapool.test' },
  ],
} as const;

/** bcrypt "cost": how many rounds of hashing. Higher = slower to crack, slower to compute. */
const BCRYPT_COST = 10;

/**
 * Creates (or updates) Jashim, Bullet, Nusrat, Rafiq and Shirin.
 * Idempotent: running it twice leaves exactly the same data, because every write is an
 * "upsert" (update if it exists, insert if it does not), keyed by email or driver.
 */
export async function seedCast(prisma: PrismaClient): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);

  // A transaction: either the whole cast is saved, or none of it is.
  await prisma.$transaction(async (tx) => {
    const jashim = await tx.user.upsert({
      where: { email: CAST.driver.email },
      update: { name: CAST.driver.name, role: 'DRIVER' },
      create: { name: CAST.driver.name, email: CAST.driver.email, passwordHash, role: 'DRIVER' },
    });

    await tx.driverProfile.upsert({
      where: { userId: jashim.id },
      update: {},
      create: { userId: jashim.id },
    });

    await tx.vehicle.upsert({
      where: { driverId: jashim.id },
      update: { name: CAST.driver.vehicle.name, capacity: CAST.driver.vehicle.capacity },
      create: {
        driverId: jashim.id,
        name: CAST.driver.vehicle.name,
        capacity: CAST.driver.vehicle.capacity,
      },
    });

    for (const passenger of CAST.passengers) {
      await tx.user.upsert({
        where: { email: passenger.email },
        update: { name: passenger.name, role: 'PASSENGER' },
        create: { name: passenger.name, email: passenger.email, passwordHash, role: 'PASSENGER' },
      });
    }
  });
}
