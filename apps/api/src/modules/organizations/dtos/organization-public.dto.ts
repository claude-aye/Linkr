import { Exclude, Expose } from 'class-transformer';

// Public projection — excludes sensitive corporate fields (legalName,
// legalAddress, billingEmail, businessNumber) so it is safe for anonymous SSR.
@Exclude()
export class OrganizationPublicDto {
  @Expose() id!: string;
  @Expose() displayName!: string;
  @Expose() slug!: string;
  @Expose() logoUrl!: string | null;
  @Expose() description!: string;
  @Expose() countryCode!: string;
  @Expose() subdivisionCode!: string;
  @Expose() isActive!: boolean;
  @Expose() createdAtUtc!: Date;
  @Expose() updatedAtUtc!: Date;
}
