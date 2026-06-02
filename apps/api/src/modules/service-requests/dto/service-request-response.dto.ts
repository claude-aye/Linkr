import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GeoJSONPoint } from '../../../common/geojson/geojson.types';
import { ServiceRequestStatus } from '../enums/service-request-status.enum';
import { ServiceRequestType } from '../enums/service-request-type.enum';

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
  @ApiPropertyOptional() desiredStartAtUtc!: Date | null;
  @ApiPropertyOptional() desiredEndAtUtc!: Date | null;
  @ApiPropertyOptional() scheduledAtUtc!: Date | null;
  @ApiPropertyOptional() estimatedAmount!: string | null;
  @ApiPropertyOptional() estimatedCurrency!: string | null;
  @ApiPropertyOptional() finalAmount!: string | null;
  @ApiPropertyOptional() finalCurrency!: string | null;
  @ApiPropertyOptional() responseDeadlineUtc!: Date | null;
  @ApiPropertyOptional() quotesDeadlineUtc!: Date | null;
  @ApiPropertyOptional() acceptedAtUtc!: Date | null;
  @ApiPropertyOptional() completedAtUtc!: Date | null;
  @ApiPropertyOptional() paidAtUtc!: Date | null;
  @ApiPropertyOptional() cancelledAtUtc!: Date | null;
  @ApiPropertyOptional() cancellationReason!: string | null;
  @ApiPropertyOptional() cancelledByUserId!: string | null;
  @ApiProperty() createdAtUtc!: Date;
  @ApiProperty() updatedAtUtc!: Date;
}
