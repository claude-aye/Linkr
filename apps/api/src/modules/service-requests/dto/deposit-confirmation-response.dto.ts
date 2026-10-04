import { ApiProperty } from '@nestjs/swagger';

/**
 * What the browser needs to confirm a deposit's EXISTING PaymentIntent
 * (`POST /service-requests/:id/deposit-confirmation`):
 * `stripe.confirmCardPayment(clientSecret, { payment_method: stripePaymentMethodId })`.
 *
 * `stripePaymentMethodId` is the client's CURRENT default card, passed
 * explicitly because a PaymentIntent does not follow a change of default card
 * (D2.2). `grossAmount`/`currency` are the ledger row's — checked equal to the
 * intent's before anything is returned.
 */
export class DepositConfirmationResponseDto {
  @ApiProperty({ format: 'uuid' })
  serviceRequestId!: string;

  @ApiProperty({ description: 'Client secret of the deposit PaymentIntent (browser-side confirmation)' })
  clientSecret!: string;

  @ApiProperty({ description: 'Stripe id of the card to confirm with (the client’s current default)' })
  stripePaymentMethodId!: string;

  @ApiProperty({ type: String, description: 'Deposit amount, decimal string (e.g. "30.00")' })
  grossAmount!: string;

  @ApiProperty({ type: String, description: 'ISO 4217, upper-case' })
  currency!: string;
}
