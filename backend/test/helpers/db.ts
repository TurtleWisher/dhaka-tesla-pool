import { expect } from 'vitest';
import { createPrismaClient, type PrismaClient } from '../../src/lib/prisma.js';

/** A database client for tests. DATABASE_URL points at the TEST database (vitest.config.ts). */
export function createTestPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url?.includes('_test')) {
    // Safety net: never let a test wipe the development database.
    throw new Error(`Tests must run against a *_test database, got: ${url}`);
  }
  return createPrismaClient(url);
}

/** Empties every table so each test starts from a clean, known state. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE ride_events, pool_members, ride_requests, pools, vehicles, driver_profiles, users
    RESTART IDENTITY CASCADE`);
}

/**
 * Asserts that a database write fails because it breaks the named unique index.
 * Prisma reports unique violations as error code P2002 and puts the index name in `meta`.
 */
export async function expectUniqueViolation(write: Promise<unknown>, indexName: string): Promise<void> {
  await expect(write).rejects.toSatisfy(
    (err: { code?: string; meta?: unknown }) =>
      err.code === 'P2002' && JSON.stringify(err.meta).includes(indexName),
  );
}
