import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Creates the database client.
 * Prisma talks to PostgreSQL through the `pg` driver adapter.
 * The URL is passed in (not read here) so tests can point at the test database.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

export type { PrismaClient };
