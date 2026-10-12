import { ApiProperty } from '@nestjs/swagger';
import { PaymentType } from '../../payments/enums/payment-type.enum';
import type { DepositAwaitingConfirmationRecord } from '../repositories/service-request.repository';

/**
 * One payment the client can still confirm from their browser
 * (`GET /service-requests/deposits-awaiting-confirmation`): a DEPOSIT since
 * the 3-D Secure chantier, a BALANCE too since its balance lot. The route
 * keeps its name — renaming it would break the contract for nothing.
 *
 * Deliberately thin: NO `clientSecret` (it is not stored, and is handed out
 * only on a click, by `POST :id/deposit-confirmation`) and NO raw Stripe
 * failure message (an untranslated, sometimes internal string — « No such
 * PaymentMethod… » — that the client cannot act on).
 */
export class DepositAwaitingConfirmationItemDto {
  @ApiProperty({ format: 'uuid' })
  serviceRequestId!: string;

  /**
   * Which payment of the request awaits confirmation — and therefore which
   * endpoint the button calls (`POST :id/deposit-confirmation` or
   * `POST :id/balance-confirmation`). ADDITIVE: an existing reader that
   * ignores it keeps working; every item it saw before is a `DEPOSIT`.
   */
  @ApiProperty({
    enum: [PaymentType.DEPOSIT, PaymentType.BALANCE],
    description:
      'DEPOSIT (20 %, at acceptance) or BALANCE (80 %, at completion) — selects the confirmation endpoint',
  })
  paymentType!: PaymentType.DEPOSIT | PaymentType.BALANCE;

  @ApiProperty({ description: 'Title of the service request, as the client wrote it' })
  title!: string;

  @ApiProperty({
    type: String,
    description: 'Amount of this payment (deposit or balance), decimal string (e.g. "30.00")',
  })
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
    dto.paymentType = record.paymentType;
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
