import { HttpException, HttpStatus } from '@nestjs/common';

/** Machine-readable codes of this flow. Part of the contract: L2 maps on them. */
export const EMAIL_VERIFICATION_TOKEN_INVALID = 'EMAIL_VERIFICATION_TOKEN_INVALID';
export const EMAIL_VERIFICATION_BUDGET_EXHAUSTED =
  'EMAIL_VERIFICATION_BUDGET_EXHAUSTED';

/**
 * 400 — one response for every token failure: unknown, expired, already used,
 * replaced by a resend, or issued for an address that is no longer the
 * account's. No detail: the caller cannot tell which, and neither can the user.
 */
export class InvalidEmailVerificationTokenException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        code: EMAIL_VERIFICATION_TOKEN_INVALID,
        message:
          'Ce lien de confirmation est invalide, a expiré ou a déjà servi. Connectez-vous pour en demander un nouveau.',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 503 — today's verification-email budget (EMAIL_VERIFICATION_DAILY_BUDGET,
 * Toronto day) is spent. Raised BEFORE anything is created: no account on
 * sign-up, no token on resend. French and user-facing: the front shows it.
 */
export class EmailVerificationBudgetExhaustedException extends HttpException {
  constructor(context: 'signup' | 'resend') {
    super(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        code: EMAIL_VERIFICATION_BUDGET_EXHAUSTED,
        message:
          context === 'signup'
            ? "Les inscriptions sont saturées aujourd'hui, réessayez demain."
            : "Les envois de courriels de confirmation sont saturés aujourd'hui, réessayez demain.",
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
