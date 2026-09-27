import type { UserRole } from '../../generated/prisma/enums.js';
import { AppError } from '../../lib/errors.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prismaErrors.js';
import { type LoginInput, MAX_PASSWORD_BYTES, type RegisterInput } from './auth.schemas.js';
import { hashPassword, verifyPassword } from './password.js';

/** What the API ever shows about a user. Never the password hash. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

const publicUser = { id: true, name: true, email: true, role: true } as const;

/** One message for "no such email" and "wrong password", so nobody can probe which emails exist. */
const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

export function createAuthService(prisma: PrismaClient, bcryptCost: number) {
  // A hash to compare against when the email is unknown, so that case takes about as long
  // as a wrong password. Created on first use, then reused.
  let dummyHash: Promise<string> | undefined;
  const getDummyHash = () => (dummyHash ??= hashPassword('dtp-timing-equaliser', bcryptCost));

  return {
    /** Creates a PASSENGER account. A duplicate email is a 409, also when two sign-ups race. */
    async register(input: RegisterInput): Promise<PublicUser> {
      const passwordHash = await hashPassword(input.password, bcryptCost);
      try {
        return await prisma.user.create({
          data: { name: input.name, email: input.email, passwordHash, role: 'PASSENGER' },
          select: publicUser,
        });
      } catch (err) {
        if (isUniqueViolation(err, 'users_email_key')) {
          throw new AppError(409, 'EMAIL_TAKEN', 'This email is already registered');
        }
        throw err;
      }
    },

    /** Checks email and password. Every failure is the same 401. */
    async login(input: LoginInput): Promise<PublicUser> {
      const user = await prisma.user.findUnique({ where: { email: input.email } });
      // Always run one bcrypt comparison, whether or not the user exists.
      const matches = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
      // bcrypt ignores bytes after the 72nd, so a longer password could otherwise "match".
      const fits = Buffer.byteLength(input.password, 'utf8') <= MAX_PASSWORD_BYTES;
      if (!user || !matches || !fits) {
        throw invalidCredentials();
      }
      return { id: user.id, name: user.name, email: user.email, role: user.role };
    },

    /** The signed-in user. If the account no longer exists, the session is no longer valid. */
    async getMe(userId: string): Promise<PublicUser> {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: publicUser });
      if (!user) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
      }
      return user;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
