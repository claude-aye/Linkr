import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateProviderCategoryDto {
  @ApiPropertyOptional({ description: 'Pause or resume this category for the provider' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
