import bcrypt from 'bcrypt';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CAST, DEMO_PASSWORD, seedCast } from '../../src/db/seedCast.js';
import { createTestPrisma, resetDatabase } from '../helpers/db.js';

const prisma = createTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('seed data (the story cast)', () => {
  it('[I-SEED-01] creates Jashim with Bullet (3 seats) and three passengers', async () => {
    await seedCast(prisma);

    const jashim = await prisma.user.findUniqueOrThrow({
      where: { email: CAST.driver.email },
      include: { driverProfile: { include: { vehicle: true } } },
    });
    expect(jashim.role).toBe('DRIVER');
    expect(jashim.driverProfile?.isOnline).toBe(false);
    expect(jashim.driverProfile?.vehicle).toMatchObject({ name: 'Bullet', capacity: 3 });

    const passengers = await prisma.user.findMany({
      where: { role: 'PASSENGER' },
      orderBy: { name: 'asc' },
    });
    expect(passengers.map((p) => p.name)).toEqual(['Nusrat', 'Rafiq', 'Shirin']);
  });

  it('[I-SEED-01] stores bcrypt hashes, never the plain password', async () => {
    await seedCast(prisma);

    const nusrat = await prisma.user.findUniqueOrThrow({ where: { email: 'nusrat@teslapool.test' } });
    expect(nusrat.passwordHash).not.toBe(DEMO_PASSWORD);
    expect(nusrat.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt hashes start with $2a$, $2b$ or $2y$
    expect(await bcrypt.compare(DEMO_PASSWORD, nusrat.passwordHash)).toBe(true);
  });

  it('[I-SEED-01] is idempotent: running it twice changes nothing', async () => {
    await seedCast(prisma);
    await seedCast(prisma);

    expect(await prisma.user.count()).toBe(4);
    expect(await prisma.driverProfile.count()).toBe(1);
    expect(await prisma.vehicle.count()).toBe(1);
  });
});
