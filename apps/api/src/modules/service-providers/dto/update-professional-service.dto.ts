import { OmitType, PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateProfessionalServiceDto } from './create-professional-service.dto';

class UpdateProfessionalServiceBase extends PartialType(
  OmitType(CreateProfessionalServiceDto, ['serviceItemId'] as const),
) {}

export class UpdateProfessionalServiceDto extends UpdateProfessionalServiceBase {
  @ApiPropertyOptional({ description: 'Toggle this offering active/inactive' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
