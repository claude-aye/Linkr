import { ApiProperty } from '@nestjs/swagger';
import {
  EMAIL_VERIFICATION_BUDGET_EXHAUSTED,
  EMAIL_VERIFICATION_SEND_FAILED,
} from '../email-verification.exceptions';

export const RESEND_VERIFICATION_ERROR_CODES = [
  EMAIL_VERIFICATION_BUDGET_EXHAUSTED,
  EMAIL_VERIFICATION_SEND_FAILED,
] as const;
export type ResendVerificationErrorCode = (typeof RESEND_VERIFICATION_ERROR_CODES)[number];

/**
 * Body of the 503s of `POST /auth/verify-email/resend` (L1d): documentation of
 * the exception bodies already thrown (EmailVerificationBudgetExhaustedException,
 * EmailVerificationSendFailedException), so the web can read `code` typed. The
 * front chooses its message by `code`, the French `message` is a fallback.
 */
export class ResendVerificationErrorDto {
  @ApiProperty({ example: 503 })
  statusCode!: number;

  @ApiProperty({ example: 'Service Unavailable' })
  error!: string;

  @ApiProperty({
    enum: RESEND_VERIFICATION_ERROR_CODES,
    enumName: 'ResendVerificationErrorCode',
    description:
      'EMAIL_VERIFICATION_BUDGET_EXHAUSTED: today\'s resend budget is spent, no token created. ' +
      'EMAIL_VERIFICATION_SEND_FAILED: the mail could not be queued; the previous link still works.',
  })
  code!: ResendVerificationErrorCode;

  @ApiProperty({ description: 'User-facing French message.' })
  message!: string;
}
