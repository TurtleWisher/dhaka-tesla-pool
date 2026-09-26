import { defineConfig } from 'vitest/config';

// Load the repository's root .env if it exists (in CI the variables come from the workflow instead).
try {
  process.loadEnvFile('../.env');
} catch {
  // No .env file: rely on real environment variables.
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env in the repository root.');
}

export default defineConfig({
  test: {
    // Runs once before all tests: creates the test database if needed and applies migrations.
    globalSetup: './test/global-setup.ts',
    // Every test file talks to the TEST database, never the development one.
    env: { DATABASE_URL: testDatabaseUrl, NODE_ENV: 'test' },
    // Test files share one database, so run them one at a time to keep them independent.
    fileParallelism: false,
  },
});
