import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { EmailService } from '../../common/email/email.service';
import { FixedWindowCounter } from '../../common/rate-limit/fixed-window-counter';
import { AuthProviderType } from '../users/enums/auth-provider-type.enum';
import { UsersRepository } from '../users/users.repository';
import { AuthService } from './auth.service';
import {
  NoEmailPasswordProviderError,
  PasswordResetTokenRepository,
} from './password-reset-token.repository';

/** A-2.1: 32 bytes of cryptographic randomness, base64url-encoded. */
const TOKEN_BYTES = 32;

/**
 * A-2.3. Also the REAL ceiling on how long a token can be exposed: a failed
 * email job keeps its whole payload in Redis for up to 24 h (EMAIL_JOB_OPTIONS),
 * and nothing can re-read the secret from the database, so this lifetime — not
 * Redis eviction — is what bounds the risk. Do not lengthen it.
 */
export const RESET_TOKEN_TTL_MINUTES = 60;

/**
 * Anti-bombardment cap: how many reset emails one address may trigger per window.
 * Generous for a human who mistypes or does not find the first mail, useless to
 * someone using the endpoint as a mail cannon aimed at a third party.
 */
const SEND_CAP_PER_EMAIL = 5;
const SEND_CAP_WINDOW_SECONDS = 60 * 60;

/**
 * The single error every token failure collapses into (A-2.9 / decision 9).
 *
 * Unknown, expired, already consumed, rotated away by a newer request — one
 * response, one message. Deliberately NOT a 404: a 404 would confirm that some
 * other hash DOES exist, which is the one bit of information this flow exists to
 * withhold. Deliberately not 401/403 either — nobody is authenticated here, and
 * those codes invite clients to go refresh a session that is not the problem.
 *
 * The copy is French and user-facing because the front shows it verbatim, and it
 * names ROTATION first: asking twice and clicking the older mail is the most
 * common way to land here, and « demandez-en un nouveau » is the only thing the
 * reader can act on.
 */
export class InvalidResetTokenException extends BadRequestException {
  constructor() {
    super(
      'Ce lien a été remplacé ou a expiré. Veuillez demander un nouveau lien de réinitialisation.',
    );
  }
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  /**
   * ⚠️ IN MEMORY, AND AT THE SERVICE LEVEL — BOTH HALVES ARE THE DECISION.
   *
   * **At the service level, never an HTTP guard.** A guard would short-circuit
   * the response, so the 202 would stop coming out for capped addresses and the
   * silence would become observable — turning an abuse control into the exact
   * enumeration oracle A-2.12 exists to prevent. This counter suppresses the
   * SEND and nothing else; the response is byte-identical either way.
   *
   * **In memory, reusing `FixedWindowCounter` (#78), not Redis.** Same reasoning
   * as the demand-signals limiter: a Redis-backed counter must choose between
   * failing open (no protection exactly when the system is stressed) and failing
   * closed (password reset dies over a cache outage), and an in-memory counter
   * has neither dilemma.
   *
   * ⚠️ THE CAP IS PER PROCESS, SO IT MULTIPLIES BY INSTANCE. Replicate the API
   * and one address can trigger N × `SEND_CAP_PER_EMAIL` mails per window, with
   * no error and no log. It degrades gently (more mail to a real address, never
   * fewer) rather than breaking anything, which is why this is a caveat and not
   * a blocker — but the way out is a shared counter, never a smaller constant.
   *
   * The key is the SHA-256 of the normalised address, not the address: a
   * plaintext email list sitting in process memory is a thing worth not having,
   * and the counter only ever needs equality.
   */
  private readonly sendCap = new FixedWindowCounter();

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly tokenRepository: PasswordResetTokenRepository,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Starts a reset. ALWAYS resolves, whatever happened (A-2.12).
   *
   * The controller answers 202 with a constant body before, after and regardless
   * of anything below: unknown address, known address, tenth request in a row,
   * send suppressed by the cap, SMTP in flames. There is no branch a caller can
   * observe.
   *
   * ⚠️ RESIDUAL TIMING GAP, ACKNOWLEDGED RATHER THAN PAPERED OVER (A-2.14). The
   * known-account path does more work than the unknown one — a lookup plus a
   * transaction plus an enqueue — so it takes measurably longer. It is NOT
   * masked with a random delay: a random delay averages out over enough samples,
   * so it buys nothing against the attacker who would bother measuring, while
   * costing latency for everyone. A constant-time answer here would mean doing
   * the same work for an address that does not exist, which is its own kind of
   * absurd. The honest mitigation is the IP rate limit on the route, which caps
   * how many samples an attacker can take at all.
   */
  async requestReset(email: string): Promise<void> {
    const normalisedEmail = email.trim().toLowerCase();

    const user = await this.usersRepository.findByEmailWithAuthProviders(
      normalisedEmail,
    );

    // No account. Nothing to do, nothing to say — the caller already has its 202.
    // Soft-deleted users resolve to `null` here for free: `findOne` excludes rows
    // carrying `deleted_at_utc` (@DeleteDateColumn), so a deleted account cannot
    // be reset and needed no predicate of its own.
    if (!user) {
      return;
    }

    // An account that only ever signed in with Google or Apple has no password to
    // reset. Sending it a reset link would promise something the consume path
    // cannot deliver (it would roll back on the missing provider row).
    const hasPassword = user.authProviders?.some(
      (provider) =>
        provider.providerType === AuthProviderType.EMAIL_PASSWORD &&
        provider.passwordHash,
    );
    if (!hasPassword) {
      this.logger.log(
        `Reset requested for user ${user.id} with no email/password provider — no mail sent`,
      );
      return;
    }

    if (!this.maySend(normalisedEmail)) {
      // Logged by user id, never by address, and the caller still gets its 202.
      this.logger.warn(
        `Reset email suppressed for user ${user.id}: send cap reached ` +
          `(${SEND_CAP_PER_EMAIL} per ${SEND_CAP_WINDOW_SECONDS}s)`,
      );
      return;
    }

    // The raw token exists here, in the email, and nowhere else. Only its hash is
    // persisted — see the migration docblock.
    const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAtUtc = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);

    await this.tokenRepository.rotateAndInsert(
      user.id,
      hashToken(rawToken),
      expiresAtUtc,
    );

    await this.emailService.send({
      to: user.email,
      template: 'password-reset',
      vars: {
        firstName: user.firstName,
        resetUrl: this.buildResetUrl(rawToken),
        expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
      },
    });

    // User id and outcome. NEVER the token, never the URL that carries it.
    this.logger.log(`Password reset email queued for user ${user.id}`);
  }

  /**
   * Finishes a reset: consumes the token, writes the password, expels sessions.
   *
   * The password is hashed BEFORE the transaction opens. Argon2id at these
   * parameters takes tens of milliseconds, and holding a database transaction —
   * with a row lock on the token — open across it would serialise concurrent
   * resets behind a CPU-bound hash for no benefit. The transaction stays as
   * short as the three writes it exists to make atomic.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const passwordHash = await this.authService.hashPassword(newPassword);

    let userId: string | null;
    try {
      userId = await this.tokenRepository.consumeAndSetPassword(
        hashToken(rawToken),
        passwordHash,
      );
    } catch (error) {
      // The account has no email/password provider (rolled back, token intact).
      // Surfaced as the SAME error as every other failure: telling an anonymous
      // caller "this account is OAuth-only" would leak both that the account
      // exists and how it signs in.
      if (error instanceof NoEmailPasswordProviderError) {
        this.logger.warn(error.message);
        throw new InvalidResetTokenException();
      }
      throw error;
    }

    if (!userId) {
      throw new InvalidResetTokenException();
    }

    this.logger.log(
      `Password reset completed for user ${userId}; sessions invalidated`,
    );
  }

  /** Whether this address is still under its send cap for the current window. */
  private maySend(normalisedEmail: string): boolean {
    return this.sendCap.hit(
      createHash('sha256').update(normalisedEmail).digest('hex'),
      SEND_CAP_PER_EMAIL,
      SEND_CAP_WINDOW_SECONDS * 1000,
      // Monotonic: this measures an elapsed interval, so a wall-clock step must
      // not stretch a window or release one early. Same clock as RateLimitGuard.
      performance.now(),
    ).allowed;
  }

  /**
   * The absolute link the recipient clicks.
   *
   * `WEB_APP_BASE_URL` is required rather than derived from the request: the
   * mail is rendered in a worker that has no request, and a link built from a
   * caller-supplied `Host` header is a redirect vulnerability with extra steps.
   */
  private buildResetUrl(rawToken: string): string {
    const base = this.configService
      .getOrThrow<string>('WEB_APP_BASE_URL')
      .replace(/\/+$/, '');
    return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
  }
}

/**
 * SHA-256, hex. Not Argon2id, on purpose: a random salt would make lookup by
 * equality impossible, and 32 random bytes have no weak entropy for a slow hash
 * to compensate (A-2.2).
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
