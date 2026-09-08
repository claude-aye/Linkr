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

  // ⚠️ UN SEUL ValidateIf, CONDITION DISJONCTIVE. Deux conditions mutuellement
  // exclusives rendent la validation INERTE (class-validator saute la propriété
  // dès qu'une condition est fausse, et il y en a toujours une fausse) — c'est le
  // no-op mesuré en entrée 16c, qui laissait un UUID malformé casser au cast SQL
  // en 500. Mais un ValidateIf(DIRECT_BOOKING) SEUL ne suffit pas non plus : il
  // sauterait la propriété entièrement sur un tender, y compris quand une valeur
  // MALFORMÉE est fournie — le même 500, par l'autre porte. La disjonction dit
  // les deux choses à la fois : requis pour une réservation directe, et validé
  // dès qu'une valeur est présente quel que soit le type. Ne pas « simplifier ».
  //
  // Cette forme est celle des QUATRE propriétés conditionnelles de ce DTO
  // (serviceItemId, requestedServiceProviderId, desiredStartAtUtc,
  // desiredEndAtUtc). Pour requestedServiceProviderId l'apport en comportement
  // est nul — le service refuse déjà toute valeur sur un tender
  // (TenderValidationException) — mais l'uniformité du motif est l'argument :
  // laisser la quatrième dans une autre forme obligerait chaque lecteur à
  // redémontrer pourquoi. Ne pas la « simplifier » plus tard.
  @ApiPropertyOptional({
    description:
      'Required for DIRECT_BOOKING, optional for PROJECT_TENDER (open tender).',
    format: 'uuid',
  })
  @ValidateIf(
    (o: CreateServiceRequestDto) =>
      o.requestType === ServiceRequestType.DIRECT_BOOKING || o.serviceItemId !== undefined,
  )
  @IsUUID()
  serviceItemId?: string;

  @ApiPropertyOptional({
    description:
      'Required for DIRECT_BOOKING (the specific Pro the client targets). Must be absent for PROJECT_TENDER.',
    format: 'uuid',
  })
  @ValidateIf(
    (o: CreateServiceRequestDto) =>
      o.requestType === ServiceRequestType.DIRECT_BOOKING ||
      o.requestedServiceProviderId !== undefined,
  )
  @IsUUID()
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

  // Même forme disjonctive que serviceItemId ci-dessus — la raison y est écrite
  // une seule fois, ne pas la recopier ici. Les deux bornes sont REQUISES pour
  // un DIRECT_BOOKING (D3) et facultatives pour un PROJECT_TENDER, où elles
  // restent néanmoins validées en FORME dès qu'une valeur est fournie.
  @ApiPropertyOptional({
    description:
      'Start of the desired service window. REQUIRED for DIRECT_BOOKING (with desiredEndAtUtc); optional for PROJECT_TENDER.',
    format: 'date-time',
  })
  @ValidateIf(
    (o: CreateServiceRequestDto) =>
      o.requestType === ServiceRequestType.DIRECT_BOOKING || o.desiredStartAtUtc !== undefined,
  )
  @IsDateString()
  desiredStartAtUtc?: string;

  @ApiPropertyOptional({
    description:
      'End of the desired service window. REQUIRED for DIRECT_BOOKING (with desiredStartAtUtc); optional for PROJECT_TENDER.',
    format: 'date-time',
  })
  @ValidateIf(
    (o: CreateServiceRequestDto) =>
      o.requestType === ServiceRequestType.DIRECT_BOOKING || o.desiredEndAtUtc !== undefined,
  )
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
