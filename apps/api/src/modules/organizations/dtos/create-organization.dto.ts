import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  Length,
} from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @Length(1, 200)
  legalName!: string;

  @IsString()
  @Length(1, 200)
  displayName!: string;

  @IsString()
  @Length(2, 50)
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
