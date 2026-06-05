import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeclineServiceRequestDto {
  @ApiPropertyOptional({ description: 'Optional reason for declining the request' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
