import { createHash } from 'node:crypto';

/**
 * SHA-256, hex, of a raw single-use token (password reset, email verification).
 * Not Argon2id, on purpose: a random salt would make lookup by equality
 * impossible, and 32 random bytes have no weak entropy for a slow hash to
 * compensate (A-2.2).
 *
 * Its own file so the two token services can share it without importing each
 * other (and, through `PasswordResetService`, `AuthService`).
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
