import { ApiProperty } from '@nestjs/swagger';

/**
 * What the browser needs to confirm a balance's EXISTING PaymentIntent
 * (`POST /service-requests/:id/balance-confirmation`):
 * `stripe.confirmCardPayment(clientSecret, { payment_method: stripePaymentMethodId })`.
 *
 * Twin of `DepositConfirmationResponseDto`, field for field — the web reads
 * both with one code path. A separate class only so the contract does not
 * describe a balance as a deposit.
 *
 * `stripePaymentMethodId` is the client's CURRENT default card, passed
 * explicitly because a PaymentIntent does not follow a change of default card.
 * `grossAmount`/`currency` are the ledger row's — checked equal to the
 * intent's before anything is returned.
 */
export class BalanceConfirmationResponseDto {
  @ApiProperty({ format: 'uuid' })
  serviceRequestId!: string;

  @ApiProperty({ description: 'Client secret of the balance PaymentIntent (browser-side confirmation)' })
  clientSecret!: string;

  @ApiProperty({ description: 'Stripe id of the card to confirm with (the client’s current default)' })
  stripePaymentMethodId!: string;

  @ApiProperty({ type: String, description: 'Balance amount, decimal string (e.g. "120.00")' })
  grossAmount!: string;

  @ApiProperty({ type: String, description: 'ISO 4217, upper-case' })
  currency!: string;
}
