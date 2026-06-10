import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StripeConnectAccountType } from '../enums/stripe-connect-account-type.enum';
import { StripeConnectOnboardingStatus } from '../enums/stripe-connect-onboarding-status.enum';
import { StripeConnectAccountRecord } from '../repositories/stripe-connect-account.repository';

/** Local mirror of a provider's Stripe Connect account (status endpoint). */
export class ConnectAccountResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() serviceProviderId!: string;
  @ApiProperty({ description: 'Stripe account id (acct_...).' })
  stripeAccountId!: string;
  @ApiProperty({ enum: StripeConnectAccountType })
  accountType!: StripeConnectAccountType;
  @ApiProperty({ enum: StripeConnectOnboardingStatus })
  onboardingStatus!: StripeConnectOnboardingStatus;
  @ApiProperty() chargesEnabled!: boolean;
  @ApiProperty() payoutsEnabled!: boolean;
  @ApiProperty({
    type: [String],
    description: "Snapshot of Stripe's requirements.currently_due field keys.",
  })
  requirementsCurrentlyDue!: string[];
  @ApiProperty({ description: 'ISO 3166-1 alpha-2.' })
  countryCode!: string;
  @ApiProperty({ description: 'ISO 4217, stored UPPERCASE.' })
  defaultCurrency!: string;
  @ApiPropertyOptional({ description: 'First time the account became VERIFIED.' })
  onboardedAtUtc!: Date | null;
  @ApiProperty() createdAtUtc!: Date;
  @ApiProperty() updatedAtUtc!: Date;

  static from(record: StripeConnectAccountRecord): ConnectAccountResponseDto {
    const dto = new ConnectAccountResponseDto();
    dto.id = record.id;
    dto.serviceProviderId = record.serviceProviderId;
    dto.stripeAccountId = record.stripeAccountId;
    dto.accountType = record.accountType;
    dto.onboardingStatus = record.onboardingStatus;
    dto.chargesEnabled = record.chargesEnabled;
    dto.payoutsEnabled = record.payoutsEnabled;
    dto.requirementsCurrentlyDue = record.requirementsCurrentlyDue;
    dto.countryCode = record.countryCode;
    dto.defaultCurrency = record.defaultCurrency;
    dto.onboardedAtUtc = record.onboardedAtUtc;
    dto.createdAtUtc = record.createdAtUtc;
    dto.updatedAtUtc = record.updatedAtUtc;
    return dto;
  }
}
