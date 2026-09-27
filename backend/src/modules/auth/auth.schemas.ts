import { z } from 'zod';

/** bcrypt only looks at the first 72 bytes of a password; anything longer is silently ignored. */
export const MAX_PASSWORD_BYTES = 72;

/** Emails are compared and stored in lowercase, without surrounding spaces. */
const Email = z
  .string({ error: 'Enter your email address' })
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254, 'Email is too long'));

export const RegisterBody = z.object({
  name: z.string({ error: 'Enter your name' }).trim().min(1, 'Enter your name').max(80, 'Name is too long'),
  email: Email,
  password: z
    .string({ error: 'Enter a password' })
    .min(8, 'Password must be at least 8 characters')
    .refine((password) => Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES, {
      message: `Password must be at most ${MAX_PASSWORD_BYTES} bytes (about ${MAX_PASSWORD_BYTES} characters)`,
    }),
  // No `role` field: every sign-up is a passenger (drivers are created by the seed).
});
export type RegisterInput = z.infer<typeof RegisterBody>;

/** Login does not re-apply the password rules; it only checks that something was typed. */
export const LoginBody = z.object({
  email: Email,
  password: z
    .string({ error: 'Enter your password' })
    .min(1, 'Enter your password')
    .max(1024, 'Password is too long'),
});
export type LoginInput = z.infer<typeof LoginBody>;
