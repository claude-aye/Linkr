import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * Query for the provider-facing tender feed
 * (`GET /service-providers/:id/tenders`).
 *
 * Pagination only — same bounds as the dashboard listing next door. There is
 * deliberately no `status` filter: the feed's whole definition is "OPEN tenders
 * still taking quotes", so a status parameter could only ever narrow it to
 * nothing or restate it.
 */
export class ListProviderTendersDto {
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
