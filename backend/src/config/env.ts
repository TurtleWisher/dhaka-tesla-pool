import { z } from 'zod';

/** bcrypt cost (2^cost rounds). 4 is the minimum bcrypt allows; above 15 a login would take seconds. */
export const BcryptCostSchema = z.coerce.number().int().min(4).max(15).default(12);

// Every environment variable the API reads is declared (and validated) here, in one place.
// More variables are added as the features that need them are built.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  // Signs session tokens. No default on purpose: a missing or short secret stops the server.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // The only website allowed to send state-changing requests (the Next.js app).
  // Normalised to its origin, e.g. "http://localhost:3000/" becomes "http://localhost:3000".
  FRONTEND_ORIGIN: z
    .url({ protocol: /^https?$/ })
    .default('http://localhost:3000')
    .transform((value) => new URL(value).origin),
  BCRYPT_COST: BcryptCostSchema,
  // Login and register attempts allowed per IP address per 15 minutes.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
}).refine(
  // The committed .env.example secret is public, so production must never run with it.
  (env) => !(env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('local-dev-only')),
  {
    message: 'JWT_SECRET is the public example value; set a real secret in production',
    path: ['JWT_SECRET'],
  },
);

export type Env = z.infer<typeof EnvSchema>;

/** The settings the Express app itself needs (tests build this object directly). */
export type AppConfig = Pick<
  Env,
  'NODE_ENV' | 'JWT_SECRET' | 'FRONTEND_ORIGIN' | 'BCRYPT_COST' | 'AUTH_RATE_LIMIT_MAX'
>;

/**
 * Reads and validates environment variables.
 * Fails fast: a misconfigured server should refuse to start rather than misbehave later.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
