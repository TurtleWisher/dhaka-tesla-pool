import { Prisma } from '../generated/prisma/client.js';

/**
 * True when a write failed because it broke the named unique index,
 * e.g. isUniqueViolation(err, 'users_email_key') for a duplicate email.
 * Prisma reports unique violations as P2002 and names the index in `meta`.
 */
export function isUniqueViolation(err: unknown, indexName: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    JSON.stringify(err.meta ?? {}).includes(indexName)
  );
}
