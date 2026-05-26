import { Type } from 'class-transformer';
import {
  IsLocale,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class GeoLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  displayName?: string;

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @IsOptional()
  @IsLocale()
  languagePreference?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @Length(4, 10)
  subdivisionCode?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  preferredCurrency?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoLocationDto)
  defaultLocation?: GeoLocationDto;
}
