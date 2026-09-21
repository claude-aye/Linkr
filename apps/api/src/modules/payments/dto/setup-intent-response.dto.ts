import { ApiProperty } from '@nestjs/swagger';

/**
 * Everything the browser needs to confirm a SetupIntent, and nothing else.
 *
 * ⚠️ DELIBERATELY ONE FIELD. The SetupIntent id and the Customer id are Stripe
 * identifiers the front has no use for: `stripe.confirmSetup()` takes the
 * client secret alone, and the saved method comes back from
 * `POST /payment-methods` — the single write path. Shipping either id would
 * hand the browser a handle on a Stripe object it must never address directly,
 * and would invite a second, client-driven write path to grow beside the first.
 */
export class SetupIntentResponseDto {
  @ApiProperty({
    description:
      'Client secret of the SetupIntent, consumed by Stripe.js to collect and authenticate the card.',
    example: 'seti_1234_secret_5678',
  })
  clientSecret!: string;
}
