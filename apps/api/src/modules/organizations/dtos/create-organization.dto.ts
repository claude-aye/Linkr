import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
} from 'class-validator';

export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MESSAGE =
  'slug must be lowercase alphanumeric segments separated by single hyphens';

export class CreateOrganizationDto {
  @IsString()
  @Length(1, 200)
  legalName!: string;

  @IsString()
  @Length(1, 200)
  displayName!: string;

  @IsString()
  @Length(3, 50)
  @Matches(SLUG_REGEX, { message: SLUG_MESSAGE })
  slug!: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @Length(1, 500)
  legalAddress!: string;

  @IsString()
  @Length(2, 2)
  countryCode!: string;

  @IsString()
  @Length(4, 10)
  subdivisionCode!: string;

  @IsEmail()
  billingEmail!: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  businessNumber?: string;
}
