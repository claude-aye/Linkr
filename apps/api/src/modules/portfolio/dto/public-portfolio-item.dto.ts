import { ApiProperty } from '@nestjs/swagger';
import { portfolioImageUrl } from '../constants';
import { PortfolioItemRecord } from '../repositories/portfolio-item.repository';

/**
 * A photo as ANYONE sees it — `{ id, caption, width, height, imageUrl }` and
 * nothing more: no position (the order of the list says it), no dates, no
 * size, and never the storage key. `imageUrl` is relative to the web origin.
 */
export class PublicPortfolioItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;

  @ApiProperty({ type: String, nullable: true })
  caption!: string | null;

  @ApiProperty({ type: 'integer' }) width!: number;

  @ApiProperty({ type: 'integer' }) height!: number;

  @ApiProperty({
    description: 'Relative URL on the WEB origin, e.g. /media/portfolio/{id}. Never absolute.',
    example: '/media/portfolio/00000000-0000-0000-0000-000000000000',
  })
  imageUrl!: string;

  static from(item: PortfolioItemRecord): PublicPortfolioItemDto {
    const dto = new PublicPortfolioItemDto();
    dto.id = item.id;
    dto.caption = item.caption;
    dto.width = item.width;
    dto.height = item.height;
    dto.imageUrl = portfolioImageUrl(item.id);
    return dto;
  }
}

/** Envelope of `GET /service-providers/:id/portfolio`, in display order. */
export class PublicPortfolioListDto {
  @ApiProperty({ type: PublicPortfolioItemDto, isArray: true })
  items!: PublicPortfolioItemDto[];
}
