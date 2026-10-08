import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * The only field a provider may change on a trade claim — and it is REQUIRED.
 *
 * It used to be `@IsOptional()`: a `PATCH {}` then passed validation and sent
 * `{ isActive: undefined }` to TypeORM, with nothing to write (risk of a 500).
 * The body of this route has no other purpose, so an empty one is a 400.
 */
export class UpdateProviderCategoryDto {
  @ApiProperty({ description: 'Pause or resume this category for the provider' })
  @IsBoolean()
  isActive!: boolean;
}
