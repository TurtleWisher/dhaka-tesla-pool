import { execSync } from 'node:child_process';
import { createPrismaClient } from '../src/lib/prisma.js';

/**
 * Runs once before the whole test suite (see vitest.config.ts):
 * 1. creates the test database if it does not exist yet,
 * 2. applies every migration to it, so its tables match the schema exactly.
 * Tests then reset the data themselves (test/helpers/db.ts).
 */
export default async function setup(): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL is not set');

  const url = new URL(testUrl);
  const databaseName = url.pathname.slice(1); // "/dhaka_tesla_pool_test" -> "dhaka_tesla_pool_test"
  if (!/^[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Refusing unexpected test database name: ${databaseName}`);
  }

  // Connect to the built-in "postgres" database to check for / create the test database.
  url.pathname = '/postgres';
  const admin = createPrismaClient(url.toString());
  try {
    const existing = await admin.$queryRaw<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname = ${databaseName}`;
    if (existing.length === 0) {
      // CREATE DATABASE cannot take a query parameter; the name was validated above.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  // Apply all migrations to the test database (same command a deployment uses).
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'ignore',
  });
}
