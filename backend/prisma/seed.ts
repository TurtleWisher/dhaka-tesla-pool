// Entry point for `npm run db:seed` (Prisma runs this file with tsx).
// The actual seeding logic lives in src/db/seedCast.ts so tests can call it too.
import { BcryptCostSchema } from '../src/config/env.js';
import { CAST, DEMO_PASSWORD, seedCast } from '../src/db/seedCast.js';
import { createPrismaClient } from '../src/lib/prisma.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env in the repository root.');
}

// Same cost setting (and the same validation) as the API uses for new accounts.
const bcryptCost = BcryptCostSchema.parse(process.env.BCRYPT_COST);

const prisma = createPrismaClient(databaseUrl);

try {
  await seedCast(prisma, { bcryptCost });
  const everyone = [CAST.driver, ...CAST.passengers].map((person) => person.name).join(', ');
  console.log(`Seeded ${everyone} and the Tesla "${CAST.driver.vehicle.name}".`);
  console.log(`Demo password for every account: ${DEMO_PASSWORD}`);
} finally {
  await prisma.$disconnect();
}
