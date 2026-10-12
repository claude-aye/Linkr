import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  Matches,
  Length,
} from 'class-validator';
import { CURRENT_TERMS_VERSION } from '../terms-version';

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsString()
  @Length(2, 2)
  countryCode!: string;

  @IsString()
  @Length(4, 6)
  subdivisionCode!: string;

  @IsString()
  @Length(3, 3)
  preferredCurrency!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  languagePreference?: string;

  /**
   * Consent to the terms and privacy policy (PR L2). Must be the boolean
   * `true` — `@Equals` is strict, so `"true"`, `1`, `false` and absence are all
   * a 400. The DATE of acceptance is never received: the server stamps it.
   */
  @ApiProperty({
    description:
      'Must be the boolean true: the person accepts the terms of use and the privacy policy. The acceptance date is set by the server, never sent.',
    enum: [true],
    example: true,
  })
  @Equals(true, { message: 'acceptTerms must be true' })
  acceptTerms!: true;

  /**
   * The version of the texts accepted. Added server-side by the web BFF
   * (`LEGAL_VERSION`), never typed by the person — and checked here against the
   * API's own constant, so a stale or forged version cannot be recorded.
   */
  @ApiProperty({
    description:
      'Version (civil date YYYY-MM-DD) of the legal texts accepted. Must equal the current version, otherwise 400.',
    enum: [CURRENT_TERMS_VERSION],
    example: CURRENT_TERMS_VERSION,
  })
  @Equals(CURRENT_TERMS_VERSION, {
    message: `termsVersion must be ${CURRENT_TERMS_VERSION}`,
  })
  termsVersion!: string;
}
