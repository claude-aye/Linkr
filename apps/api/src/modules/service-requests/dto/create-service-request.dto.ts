import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsGeoJSONPoint } from '../../../common/validators/is-geojson-point.validator';
import { GeoJSONPoint } from '../../../common/geojson/geojson.types';
import { ServiceRequestType } from '../enums/service-request-type.enum';
import { ServiceRequestLocationPrecision } from '../enums/service-request-location-precision.enum';

export class CreateServiceRequestDto {
  @ApiProperty({ enum: ServiceRequestType })
  @IsEnum(ServiceRequestType)
  requestType!: ServiceRequestType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceCategoryId!: string;

  @ApiPropertyOptional({
    description:
      'Required for DIRECT_BOOKING, optional for PROJECT_TENDER (open tender).',
    format: 'uuid',
  })
  @ValidateIf((o: CreateServiceRequestDto) => o.requestType === ServiceRequestType.DIRECT_BOOKING)
  @IsUUID()
  @ValidateIf((o: CreateServiceRequestDto) => o.requestType === ServiceRequestType.PROJECT_TENDER)
  @IsOptional()
  serviceItemId?: string;

  @ApiPropertyOptional({
    description:
      'Required for DIRECT_BOOKING (the specific Pro the client targets). Must be absent for PROJECT_TENDER.',
    format: 'uuid',
  })
  @ValidateIf((o: CreateServiceRequestDto) => o.requestType === ServiceRequestType.DIRECT_BOOKING)
  @IsUUID()
  @ValidateIf((o: CreateServiceRequestDto) => o.requestType === ServiceRequestType.PROJECT_TENDER)
  @IsOptional()
  requestedServiceProviderId?: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  serviceAddress!: string;

  @ApiProperty({
    description: 'GeoJSON Point: { type: "Point", coordinates: [lng, lat] }.',
  })
  @IsGeoJSONPoint()
  serviceLocation!: GeoJSONPoint;

  @ApiPropertyOptional({
    enum: ServiceRequestLocationPrecision,
    description:
      'Where serviceLocation came from. Omit and the request is stored as UNKNOWN — precision is never inferred from the coordinates themselves. Provenance, not accuracy: GEOCODED does not mean exact.',
  })
  @IsOptional()
  @IsEnum(ServiceRequestLocationPrecision)
  serviceLocationPrecision?: ServiceRequestLocationPrecision;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  desiredStartAtUtc?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  desiredEndAtUtc?: string;

  @ApiPropertyOptional({ description: 'Estimated amount. Requires estimatedCurrency.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  estimatedAmount?: number;

  @ApiPropertyOptional({ description: 'ISO 4217 currency. Required when estimatedAmount is set.' })
  @ValidateIf((o: CreateServiceRequestDto) => o.estimatedAmount !== undefined)
  @IsString()
  @MaxLength(3)
  estimatedCurrency?: string;

  @ApiPropertyOptional({
    description: 'Deadline for DIRECT_BOOKING auto-expiration (timestamptz).',
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  responseDeadlineUtc?: string;

  @ApiPropertyOptional({
    description: 'Quotes deadline for PROJECT_TENDER auto-expiration (timestamptz).',
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  quotesDeadlineUtc?: string;
}
