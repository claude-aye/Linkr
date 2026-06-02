import { ApiProperty } from '@nestjs/swagger';
import { PricingModel } from '../enums/pricing-model.enum';
import { PsRecord } from '../repositories/professional-service.repository';

export class ProfessionalServiceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() professionalServiceCategoryId!: string;
  @ApiProperty() serviceItemId!: string;
  @ApiProperty({ enum: PricingModel }) pricingModel!: PricingModel;
  @ApiProperty({ nullable: true }) priceAmount!: number | null;
  @ApiProperty() priceCurrency!: string;
  @ApiProperty({ nullable: true }) estimatedDurationMinutes!: number | null;
  @ApiProperty({ nullable: true }) descriptionOverride!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAtUtc!: Date;
  @ApiProperty() updatedAtUtc!: Date;

  static from(record: PsRecord): ProfessionalServiceResponseDto {
    return Object.assign(new ProfessionalServiceResponseDto(), record);
  }
}
