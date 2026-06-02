import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddProviderCategoryDto {
  @ApiProperty({ description: 'UUID of the service category to add', format: 'uuid' })
  @IsUUID()
  serviceCategoryId!: string;
}
