import { defineConfig } from 'prisma/config';

// Prisma does not read .env files by itself. In development, load the repository's
// root .env (the Prisma CLI runs from backend/, so it is one folder up).
// In CI and Docker there is no .env file: real environment variables are used instead,
// and loadEnvFile never overrides a variable that is already set.
try {
  process.loadEnvFile('../.env');
} catch {
  // No .env file: nothing to load.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Empty fallback lets `prisma generate` run without a database;
    // commands that need a connection (migrate, seed) fail with a clear error instead.
    url: process.env.DATABASE_URL ?? '',
  },
});
