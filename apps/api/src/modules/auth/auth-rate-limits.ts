import { RateLimitOptions } from '../../common/rate-limit/rate-limit.decorator';

const ONE_HOUR = 60 * 60;
const FIFTEEN_MINUTES = 15 * 60;

/**
 * Per-caller budgets for the unauthenticated auth routes (chantier B).
 *
 * ⚠️ ALL FOUR ARE BY IP, NEVER BY EMAIL ADDRESS — AND THAT IS A SECURITY
 * PROPERTY, NOT A CONVENIENCE. A 429 that only ever came out for addresses that
 * exist is an enumeration oracle wearing a security control's clothes; and a
 * per-email budget hands anyone the power to lock a specific person out of their
 * own account by spending it for them. The caller's address is the only unit
 * that is neither of those things.
 *
 * ⚠️ THE GUARD COUNTS ATTEMPTS, NOT FAILURES — a successful sign-in spends
 * budget too. Counting only failures would mean lifting the counter out of the
 * guard and calling it from the service (a second usage model for one
 * mechanism), and it would leave a script holding stolen-but-valid credentials
 * completely uncapped. See `auth.controller.spec.ts`, which pins the ordering
 * that makes a WRONG password count at all.
 *
 * They live together, named, because they are one family read together: three
 * different numbers scattered across three decorators is three things for the
 * next person to hunt down before they can tell whether they are coherent.
 *
 * Windows differ on purpose. The two reset routes keep the fifteen minutes they
 * shipped with in A-2 — moving a number while moving a file would hide a
 * behaviour change inside a refactor. Only their location changed.
 */
export const AUTH_RATE_LIMITS = {
  /**
   * 30/h. People sign in often and legitimately — a shared household, a phone
   * that keeps dropping its session, a tab per device — so the budget has to sit
   * far above honest repetition. It still turns credential stuffing from
   * thousands of guesses an hour into thirty.
   */
  LOGIN: { limit: 30, windowSeconds: ONE_HOUR },

  /**
   * 10/h. The opposite shape of traffic: an account is created once. Ten leaves
   * room for a family or a small crew signing up from one connection, and cuts
   * bulk account creation off well before it is worth anyone's while.
   */
  SIGNUP: { limit: 10, windowSeconds: ONE_HOUR },

  /**
   * 10/15min, unchanged from A-2. Caps how hard one address can drive the mail
   * sender. It is NOT the per-address send cap — that one lives in
   * `PasswordResetService`, suppresses the SEND rather than the response, and
   * stays invisible precisely so the 202 keeps meaning nothing.
   */
  FORGOT_PASSWORD: { limit: 10, windowSeconds: FIFTEEN_MINUTES },

  /**
   * 10/15min, unchanged from A-2. A reset token is 32 random bytes, so this is
   * not what makes guessing one hopeless — it caps the noise, and keeps a broken
   * client from hammering the consume path.
   */
  RESET_PASSWORD: { limit: 10, windowSeconds: FIFTEEN_MINUTES },
} as const satisfies Record<string, RateLimitOptions>;
