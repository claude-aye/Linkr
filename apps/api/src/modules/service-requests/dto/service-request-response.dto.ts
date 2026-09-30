import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GeoJSONPoint } from '../../../common/geojson/geojson.types';
import { ServiceRequestStatus } from '../enums/service-request-status.enum';
import { ServiceRequestType } from '../enums/service-request-type.enum';
import { ServiceRequestLocationPrecision } from '../enums/service-request-location-precision.enum';

export class ServiceRequestResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() clientUserId!: string;
  @ApiProperty({ enum: ServiceRequestType }) requestType!: ServiceRequestType;
  @ApiProperty({ enum: ServiceRequestStatus }) status!: ServiceRequestStatus;
  @ApiProperty() serviceCategoryId!: string;
  @ApiPropertyOptional() serviceItemId!: string | null;
  @ApiPropertyOptional() requestedServiceProviderId!: string | null;
  @ApiPropertyOptional() assignedServiceProviderId!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() serviceAddress!: string;
  @ApiProperty() serviceLocation!: GeoJSONPoint;
  @ApiProperty({ enum: ServiceRequestLocationPrecision })
  serviceLocationPrecision!: ServiceRequestLocationPrecision;
  @ApiPropertyOptional() desiredStartAtUtc!: Date | null;
  @ApiPropertyOptional() desiredEndAtUtc!: Date | null;
  @ApiPropertyOptional() scheduledAtUtc!: Date | null;
  @ApiPropertyOptional() estimatedAmount!: string | null;
  @ApiPropertyOptional() estimatedCurrency!: string | null;
  @ApiPropertyOptional() finalAmount!: string | null;
  @ApiPropertyOptional() finalCurrency!: string | null;

  /**
   * The price both parties agreed to — the amount the deposit and balance are
   * computed from. NOT always `estimatedAmount`: a PROJECT_TENDER is charged on
   * its ACCEPTED quote, and its `estimatedAmount` stays the client's indicative
   * budget forever. Null until the request has been accepted, and null on an
   * accepted request whose price cannot be determined. Amount and currency are
   * a pair: both or neither. (Explicit `type` + `nullable`, so the generated
   * client says `string | null` instead of degrading to `Record<string, never>`.)
   */
  @ApiPropertyOptional({ type: String, nullable: true })
  agreedAmount!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  agreedCurrency!: string | null;
  @ApiPropertyOptional() responseDeadlineUtc!: Date | null;
  @ApiPropertyOptional() quotesDeadlineUtc!: Date | null;
  @ApiPropertyOptional() acceptedAtUtc!: Date | null;
  @ApiPropertyOptional() completedAtUtc!: Date | null;
  @ApiPropertyOptional() paidAtUtc!: Date | null;
  @ApiPropertyOptional() contestedAtUtc!: Date | null;
  @ApiPropertyOptional() cancelledAtUtc!: Date | null;
  @ApiPropertyOptional() cancellationReason!: string | null;
  @ApiPropertyOptional() cancelledByUserId!: string | null;
  @ApiProperty() createdAtUtc!: Date;
  @ApiProperty() updatedAtUtc!: Date;
}
