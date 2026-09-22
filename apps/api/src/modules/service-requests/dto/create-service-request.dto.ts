import {
  IsDateString,
  IsDefined,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsGeoJSONPoint } from '../../../common/validators/is-geojson-point.validator';
import { GeoJSONPoint } from '../../../common/geojson/geojson.types';
import { ServiceRequestType } from '../enums/service-request-type.enum';
import { ServiceRequestLocationPrecision } from '../enums/service-request-location-precision.enum';
import { CURRENCY_CODE_PATTERN, MAX_ESTIMATED_AMOUNT } from '../constants';

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
  // desiredEndAtUtc) — et de quotesDeadlineUtc, avec le type symétrique
  // (requis pour un PROJECT_TENDER). Pour requestedServiceProviderId l'apport en comportement
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

  // R4 — budget. Règles de FORME communes aux DEUX types de demande, et
  // appariement dans les DEUX sens : un montant sans devise ou une devise sans
  // montant sont refusés en 400. ⚠️ Avant, seul le sens montant → devise était
  // imposé : une devise seule traversait le DTO et cassait sur le CHECK
  // `chk_service_requests_estimated_pair` en 500 (mesuré sur `main`), et un
  // montant trop grand pour `numeric(12,2)` cassait en « numeric field
  // overflow », 500 aussi. Le service refait les mêmes vérifications
  // (`assertBudgetShape`) : les tests de `create()` passent sous le DTO.
  //
  // « Présent » veut dire non nul : `null` et l'absence sont équivalents, comme
  // ils le sont pour la colonne. D'où `!= null` et pas `!== undefined`.
  @ApiPropertyOptional({
    description:
      'Estimated amount, strictly positive, at most 9999999999.99 (the column holds numeric(12,2)). Must be sent together with estimatedCurrency.',
    maximum: MAX_ESTIMATED_AMOUNT,
  })
  @ValidateIf(
    (o: CreateServiceRequestDto) => o.estimatedAmount != null || o.estimatedCurrency != null,
  )
  // IsDefined porte la règle d'appariement comme message : sans lui, un montant
  // absent ne remonte que les trois validateurs suivants, qui décrivent une
  // valeur MALFORMÉE (« must not be greater than … »), pas une valeur absente.
  @IsDefined({ message: 'estimatedAmount must be sent together with estimatedCurrency' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_ESTIMATED_AMOUNT)
  estimatedAmount?: number;

  @ApiPropertyOptional({
    description:
      'ISO 4217 currency code, three UPPERCASE letters. Must be sent together with estimatedAmount.',
    pattern: CURRENCY_CODE_PATTERN.source,
  })
  @ValidateIf(
    (o: CreateServiceRequestDto) => o.estimatedAmount != null || o.estimatedCurrency != null,
  )
  @IsDefined({ message: 'estimatedCurrency must be sent together with estimatedAmount' })
  @IsString()
  @Matches(CURRENCY_CODE_PATTERN)
  estimatedCurrency?: string;

  @ApiPropertyOptional({
    description:
      'Never honoured as sent: DIRECT_BOOKING derives it and overwrites any value, PROJECT_TENDER refuses it (400) — its deadline is quotesDeadlineUtc.',
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  responseDeadlineUtc?: string;

  // R1 — même forme disjonctive que serviceItemId, symétrique : REQUIS pour un
  // PROJECT_TENDER, validé en FORME dès qu'une valeur est présente quel que soit
  // le type. Les bornes temporelles (48 h, 30 j, 24 h avant le début) vivent
  // dans le service — elles dépendent de `now`, que le DTO ne connaît pas.
  //
  // `!= null` et non `!== undefined` comme les quatre autres : l'ancien
  // `@IsOptional` laissait passer `null` sur un DIRECT_BOOKING, et ce lot ne
  // durcit pas la réservation directe au-delà du budget (R4).
  @ApiPropertyOptional({
    description:
      'REQUIRED for PROJECT_TENDER: at least 48 h and at most 30 days (30 × 24 h) from now, and at least 24 h before desiredStartAtUtc when one is given. The hourly sweep expires the tender once it has passed.',
    format: 'date-time',
  })
  @ValidateIf(
    (o: CreateServiceRequestDto) =>
      o.requestType === ServiceRequestType.PROJECT_TENDER || o.quotesDeadlineUtc != null,
  )
  @IsDefined({ message: 'quotesDeadlineUtc is required for PROJECT_TENDER' })
  @IsDateString()
  quotesDeadlineUtc?: string;
}
