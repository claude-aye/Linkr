import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/**
 * Body of `PUT /service-providers/me/portfolio/order`.
 *
 * Only the SHAPE is checked here (an array of uuids). Whether it is exactly the
 * set of the provider's live photos — none missing, none extra, none twice,
 * none someone else's — is decided by the service under the provider lock, and
 * answered with 422. ⚠️ No `@ArrayUnique` and no tight `@ArrayMaxSize` on
 * purpose: they would turn « a duplicate » or « one id too many » into a 400,
 * where the contract says 422. The ceiling below only bounds the payload.
 */
export class ReorderPortfolioDto {
  @ApiProperty({
    description:
      'Every live photo id of the provider, exactly once, in the new display order.',
    type: [String],
    format: 'uuid',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];
}
