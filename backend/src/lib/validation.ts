import { z } from 'zod';
import { AppError } from './errors.js';

/**
 * Validates a request body against a Zod schema and returns the clean, typed result.
 * Unknown fields are dropped (so a smuggled `"role": "DRIVER"` is simply ignored).
 * Invalid input: 400 VALIDATION_ERROR with the problem for each field, e.g.
 *   { "email": ["Enter a valid email address"] }
 */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const fields = z.flattenError(result.error).fieldErrors;
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', fields);
  }
  return result.data;
}
