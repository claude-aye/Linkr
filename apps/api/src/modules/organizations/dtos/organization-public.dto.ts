import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class OrganizationPublicDto {
  @Expose() id!: string;
  @Expose() legalName!: string;
  @Expose() displayName!: string;
  @Expose() slug!: string;
  @Expose() logoUrl!: string | null;
  @Expose() description!: string;
  @Expose() legalAddress!: string;
  @Expose() countryCode!: string;
  @Expose() subdivisionCode!: string;
  @Expose() billingEmail!: string;
  @Expose() businessNumber!: string | null;
  @Expose() isActive!: boolean;
  @Expose() createdAtUtc!: Date;
  @Expose() updatedAtUtc!: Date;
}
