import bcrypt from 'bcrypt';

/** Hashes a password with bcrypt. The random salt is stored inside the hash itself. */
export function hashPassword(password: string, cost: number): Promise<string> {
  return bcrypt.hash(password, cost);
}

/** True when the password matches the hash. bcrypt compares in constant time. */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
