import { ApiProperty } from '@nestjs/swagger';
import { portfolioImageUrl } from '../constants';
import { PortfolioItemRecord } from '../repositories/portfolio-item.repository';

/**
 * A photo as its OWNER sees it (the `me` routes).
 *
 * ⚠️ NO `storageKey`, ever, in any DTO of this module: the storage address
 * stays inside the API. `imageUrl` is RELATIVE to the web origin
 * (`/media/portfolio/{id}`) — the API never builds an absolute URL.
 */
export class PortfolioItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;

  @ApiProperty({ type: String, nullable: true })
  caption!: string | null;

  @ApiProperty({ type: 'integer', minimum: 0 }) position!: number;

  @ApiProperty({ type: 'integer', description: 'Width of the stored (re-encoded) image, px.' })
  width!: number;

  @ApiProperty({ type: 'integer', description: 'Height of the stored (re-encoded) image, px.' })
  height!: number;

  @ApiProperty({
    description: 'Relative URL on the WEB origin, e.g. /media/portfolio/{id}. Never absolute.',
    example: '/media/portfolio/00000000-0000-0000-0000-000000000000',
  })
  imageUrl!: string;

  @ApiProperty({ type: String, format: 'date-time' }) createdAtUtc!: string;

  static from(item: PortfolioItemRecord): PortfolioItemDto {
    const dto = new PortfolioItemDto();
    dto.id = item.id;
    dto.caption = item.caption;
    dto.position = item.position;
    dto.width = item.width;
    dto.height = item.height;
    dto.imageUrl = portfolioImageUrl(item.id);
    dto.createdAtUtc = item.createdAtUtc.toISOString();
    return dto;
  }
}

/** Envelope of `GET /service-providers/me/portfolio`. */
export class PortfolioItemListDto {
  @ApiProperty({ type: PortfolioItemDto, isArray: true })
  items!: PortfolioItemDto[];
}
