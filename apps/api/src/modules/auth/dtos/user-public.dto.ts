import { Exclude, Expose } from 'class-transformer';
import { VerificationLevel } from '../../users/enums/verification-level.enum';

@Exclude()
export class UserPublicDto {
  @Expose()
  id!: string;

  @Expose()
  email!: string;

  @Expose()
  firstName!: string;

  @Expose()
  lastName!: string;

  @Expose()
  displayName!: string | null;

  @Expose()
  avatarUrl!: string | null;

  @Expose()
  languagePreference!: string;

  @Expose()
  countryCode!: string;

  @Expose()
  subdivisionCode!: string;

  @Expose()
  preferredCurrency!: string;

  @Expose()
  verificationLevel!: VerificationLevel;

  @Expose()
  createdAtUtc!: Date;
}
