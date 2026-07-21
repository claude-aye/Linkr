import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, IsOptional, Max, Min } from 'class-validator';

/** Query parameters for `GET /geocode`. */
export class GeocodeQueryDto {
  @ApiProperty({
    description: 'Free-text address to geocode (required, non-empty).',
    example: 'Laval, Québec',
  })
  // Trim first so a whitespace-only `q` is rejected as empty (→ 400).
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  q!: string;

  @ApiPropertyOptional({
    description: 'Max candidates to return.',
    default: 5,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number = 5;
}
