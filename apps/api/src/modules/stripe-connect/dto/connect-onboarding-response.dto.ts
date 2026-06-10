import { ApiProperty } from '@nestjs/swagger';

/**
 * Result of starting (or refreshing) Express onboarding: a short-lived,
 * Stripe-hosted Account Link the provider must open to complete KYC.
 */
export class ConnectOnboardingResponseDto {
  @ApiProperty({
    description: 'Stripe-hosted onboarding URL (single-use, expires quickly).',
    example: 'https://connect.stripe.com/setup/e/acct_123/abc',
  })
  url!: string;

  @ApiProperty({
    description: 'Expiry of the onboarding link (Account Links are short-lived).',
  })
  expiresAt!: Date;
}
