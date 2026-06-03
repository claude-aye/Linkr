import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Query parameters for provider discovery. lat/lng locate the client; categoryId
 * scopes the trade. Pagination mirrors the rules used by GET /service-requests.
 */
export class DiscoverProvidersQueryDto {
  @ApiProperty({ description: 'Client latitude, -90..90.', example: 45.5017 })
  @Transform(({ value }) => parseFloat(value as string))
  @IsNumber()
  @IsLatitude()
  lat!: number;

  @ApiProperty({ description: 'Client longitude, -180..180.', example: -73.5673 })
  @Transform(({ value }) => parseFloat(value as string))
  @IsNumber()
  @IsLongitude()
  lng!: number;

  @ApiProperty({ description: 'Service category (Métier) to discover providers for.', format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
