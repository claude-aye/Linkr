import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Transform } from 'class-transformer';
import { VerificationLevel } from '../../users/enums/verification-level.enum';

/**
 * The signed-in user as the API shows them to themselves.
 *
 * A whitelist (`@Exclude` + `@Expose`, §13.1 nº 21): a column added to `users`
 * never leaks by accident. Every field carries an explicit `@ApiProperty` with
 * a concrete type, so the generated contract is complete (the Swagger plugin
 * is not enabled).
 */
@Exclude()
export class UserPublicDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @Expose()
  id!: string;

  @ApiProperty({ type: String })
  @Expose()
  email!: string;

  /**
   * Mandate L1: derived from `users.email_verified_at_utc`; the timestamp itself
   * is not exposed. Nothing gates on it yet (L3).
   */
  @ApiProperty({
    type: Boolean,
    description: 'True once the address has been confirmed (link or completed password reset).',
  })
  @Expose()
  @Transform(
    ({ obj }: { obj: { emailVerifiedAtUtc?: Date | null } }) =>
      obj.emailVerifiedAtUtc != null,
    { toClassOnly: true },
  )
  emailVerified!: boolean;

  @ApiProperty({ type: String })
  @Expose()
  firstName!: string;

  @ApiProperty({ type: String })
  @Expose()
  lastName!: string;

  @ApiProperty({ type: String, nullable: true })
  @Expose()
  displayName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  @Expose()
  avatarUrl!: string | null;

  @ApiProperty({ type: String })
  @Expose()
  languagePreference!: string;

  @ApiProperty({ type: String })
  @Expose()
  countryCode!: string;

  @ApiProperty({ type: String })
  @Expose()
  subdivisionCode!: string;

  @ApiProperty({ type: String })
  @Expose()
  preferredCurrency!: string;

  @ApiProperty({ enum: VerificationLevel, enumName: 'VerificationLevel' })
  @Expose()
  verificationLevel!: VerificationLevel;

  @ApiProperty({ type: String, format: 'date-time' })
  @Expose()
  createdAtUtc!: Date;
}
