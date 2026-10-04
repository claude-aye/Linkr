import { ApiProperty } from '@nestjs/swagger';
import type { DepositAwaitingConfirmationRecord } from '../repositories/service-request.repository';

/**
 * One deposit the client can still confirm from their browser
 * (`GET /service-requests/deposits-awaiting-confirmation`).
 *
 * Deliberately thin: NO `clientSecret` (it is not stored, and is handed out
 * only on a click, by `POST :id/deposit-confirmation`) and NO raw Stripe
 * failure message (an untranslated, sometimes internal string — « No such
 * PaymentMethod… » — that the client cannot act on).
 */
export class DepositAwaitingConfirmationItemDto {
  @ApiProperty({ format: 'uuid' })
  serviceRequestId!: string;

  @ApiProperty({ description: 'Title of the service request, as the client wrote it' })
  title!: string;

  @ApiProperty({ type: String, description: 'Deposit amount, decimal string (e.g. "30.00")' })
  grossAmount!: string;

  @ApiProperty({ type: String, description: 'ISO 4217, upper-case' })
  currency!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the off-session charge failed',
  })
  failedAtUtc!: string | null;

  static from(record: DepositAwaitingConfirmationRecord): DepositAwaitingConfirmationItemDto {
    const dto = new DepositAwaitingConfirmationItemDto();
    dto.serviceRequestId = record.serviceRequestId;
    dto.title = record.title;
    dto.grossAmount = record.grossAmount;
    dto.currency = record.currency;
    dto.failedAtUtc = record.failedAtUtc ? record.failedAtUtc.toISOString() : null;
    return dto;
  }
}

/**
 * Envelope for the list above — honest from the start (an `items` object, not
 * a bare array), and without pagination: a client has at most a handful of
 * live requests.
 */
export class DepositAwaitingConfirmationListDto {
  @ApiProperty({ type: DepositAwaitingConfirmationItemDto, isArray: true })
  items!: DepositAwaitingConfirmationItemDto[];
}
