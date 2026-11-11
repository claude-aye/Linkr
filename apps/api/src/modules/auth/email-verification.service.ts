import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { EmailBudgetService } from '../../common/email/email-budget.service';
import { EmailService } from '../../common/email/email.service';
import {
  FixedWindowCounter,
  RateLimitVerdict,
} from '../../common/rate-limit/fixed-window-counter';
import { User } from '../users/entities/user.entity';
import { UsersRepository } from '../users/users.repository';
import { ResendVerificationStatus } from './dtos/resend-verification-response.dto';
import { EmailVerificationTokenRepository } from './email-verification-token.repository';
import {
  EmailVerificationBudgetExhaustedException,
  InvalidEmailVerificationTokenException,
} from './email-verification.exceptions';
import { hashToken } from './token-hash';

const TOKEN_BYTES = 32;

/** 24 h. Also bounds how long a token can sit in a failed queued job. */
export const VERIFICATION_TOKEN_TTL_HOURS = 24;

/** Fixed path of the web page that POSTs the token back (L2). */
export const VERIFY_EMAIL_PATH = '/verify-email';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Caps on resend. The hourly per-user one is the route guard (`@RateLimit`,
 * keyed by the JWT subject); the daily per-user one and the per-IP one live in
 * this service, because the guard keys a route by ONE caller unit only.
 */
export const RESEND_LIMITS = {
  PER_USER_PER_HOUR: 3,
  PER_USER_PER_DAY: 5,
  PER_IP_PER_HOUR: 10,
} as const;

/**
 * Email verification (mandate L1). Issues, sends and consumes tokens.
 *
 * ⚠️ L1 BLOCKS NOTHING. No guard reads `email_verified_at_utc` yet (that is L3)
 * and no claim goes into the JWT. This service only writes the column.
 *
 * ⚠️ NOTHING HERE LOGS AN ADDRESS OR A TOKEN — user ids and outcomes only.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  /**
   * In memory, per process — same mechanism and same single-instance caveat as
   * `RateLimitGuard` (`FixedWindowCounter`). Keys are a user id or an IP, never
   * an address.
   */
  private readonly resendCounter = new FixedWindowCounter();

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly tokenRepository: EmailVerificationTokenRepository,
    private readonly emailService: EmailService,
    private readonly budget: EmailBudgetService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Reserves a slot in today's verification budget, or throws the 503. Called
   * by sign-up BEFORE the account is created, so a saturated day never leaves
   * an account that will not receive its link. A reserved slot is never given
   * back if sign-up then fails (see `EmailBudgetService.reserveVerification`).
   */
  async reserveForSignup(): Promise<void> {
    if (!(await this.budget.reserveVerification())) {
      throw new EmailVerificationBudgetExhaustedException('signup');
    }
  }

  /**
   * Issues a token and queues the email for a freshly created account. The
   * slot was reserved by `reserveForSignup`.
   *
   * ⚠️ NEVER THROWS: a send failure must not fail the sign-up. It is logged
   * (user id and error class only) and the user can ask for a resend.
   */
  async sendAfterSignup(user: User): Promise<void> {
    try {
      await this.issueAndSend(user);
    } catch (error) {
      this.logger.error(
        `Verification email could not be queued after sign-up for user ${user.id} ` +
          `(${error instanceof Error ? error.name : 'unknown error'})`,
      );
    }
  }

  /**
   * Daily per-user and hourly per-IP caps on resend. Counts attempts (like the
   * guard), refusals included.
   */
  checkResendLimits(userId: string, ip: string | undefined): RateLimitVerdict {
    const now = performance.now();
    const verdicts = [
      this.resendCounter.hit(
        `user-day:${userId}`,
        RESEND_LIMITS.PER_USER_PER_DAY,
        DAY_MS,
        now,
      ),
      this.resendCounter.hit(
        `ip:${ip ?? 'anonymous'}`,
        RESEND_LIMITS.PER_IP_PER_HOUR,
        HOUR_MS,
        now,
      ),
    ];
    const refused = verdicts.filter((v) => !v.allowed);
    if (refused.length === 0) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(...refused.map((v) => v.retryAfterSeconds)),
    };
  }

  /**
   * Resend for the authenticated user. Looked up BY ID — never by address.
   * Already verified → nothing sent. Otherwise reserve (503 at the cap, no
   * token created), rotate older tokens away, queue the new link.
   */
  async resend(userId: string): Promise<ResendVerificationStatus> {
    const user = await this.usersRepository.findById(userId);
    if (!user || user.emailVerifiedAtUtc) {
      // A JWT that outlived its (soft-deleted) account is answered like an
      // already-verified one: nothing to send, nothing more to say.
      return 'ALREADY_VERIFIED';
    }
    if (!(await this.budget.reserveVerification())) {
      throw new EmailVerificationBudgetExhaustedException('resend');
    }
    await this.issueAndSend(user);
    return 'SENT';
  }

  /** Consumes a token. Throws the single generic 400 on any failure. */
  async verify(rawToken: string): Promise<void> {
    const userId = await this.tokenRepository.consumeAndVerify(
      hashToken(rawToken),
    );
    if (!userId) {
      throw new InvalidEmailVerificationTokenException();
    }
    this.logger.log(`Email verified for user ${userId}`);
  }

  private async issueAndSend(user: User): Promise<void> {
    const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAtUtc = new Date(
      Date.now() + VERIFICATION_TOKEN_TTL_HOURS * HOUR_MS,
    );

    // The token records the address it is sent to (raw, as stored).
    await this.tokenRepository.rotateAndInsert(
      user.id,
      user.email,
      hashToken(rawToken),
      expiresAtUtc,
    );

    await this.emailService.send({
      to: user.email,
      template: 'email-verification',
      vars: {
        firstName: user.firstName,
        verifyUrl: this.buildVerifyUrl(rawToken),
        expiresInHours: VERIFICATION_TOKEN_TTL_HOURS,
      },
    });

    this.logger.log(`Verification email queued for user ${user.id}`);
  }

  private buildVerifyUrl(rawToken: string): string {
    const base = this.configService
      .getOrThrow<string>('WEB_APP_BASE_URL')
      .replace(/\/+$/, '');
    return `${base}${VERIFY_EMAIL_PATH}?token=${encodeURIComponent(rawToken)}`;
  }
}
