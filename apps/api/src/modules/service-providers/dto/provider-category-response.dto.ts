import { ApiProperty } from '@nestjs/swagger';
import { PscVerificationStatus } from '../enums/psc-verification-status.enum';
import { PscRecord } from '../repositories/professional-service-category.repository';

export class ProviderCategoryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() serviceProviderId!: string;
  @ApiProperty() serviceCategoryId!: string;
  @ApiProperty({ enum: PscVerificationStatus }) verificationStatus!: PscVerificationStatus;
  @ApiProperty() requestedAtUtc!: Date;
  @ApiProperty({ nullable: true }) verifiedAtUtc!: Date | null;
  @ApiProperty({ nullable: true }) rejectionReason!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAtUtc!: Date;
  @ApiProperty() updatedAtUtc!: Date;

  static from(record: PscRecord): ProviderCategoryResponseDto {
    return Object.assign(new ProviderCategoryResponseDto(), record);
  }
}
