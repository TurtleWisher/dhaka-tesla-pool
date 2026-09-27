import { z } from 'zod';
import { AppError } from './errors.js';

/**
 * Validates input against a Zod schema and returns the clean, typed result.
 * Unknown fields are dropped (so a smuggled `"role": "DRIVER"` is simply ignored).
 * Invalid input: 400 VALIDATION_ERROR with the problem for each field, e.g.
 *   { "email": ["Enter a valid email address"] }
 */
function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const fields = z.flattenError(result.error).fieldErrors;
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', fields);
  }
  return result.data;
}

/** Validates a JSON request body (`req.body`). */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  return parseInput(schema, body);
}

/** Validates the query string (`req.query`), e.g. `?pickup=BANANI&seats=2`. Values arrive as text. */
export function parseQuery<T extends z.ZodType>(schema: T, query: unknown): z.infer<T> {
  return parseInput(schema, query);
}
