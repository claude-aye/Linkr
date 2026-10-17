import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  PORTFOLIO_CAPTION_MAX,
  PORTFOLIO_MAX_BYTES,
  PORTFOLIO_MAX_ITEMS,
} from './constants';
import { PortfolioItemDto, PortfolioItemListDto } from './dto/portfolio-item.dto';
import { PublicPortfolioListDto } from './dto/public-portfolio-item.dto';
import { ReorderPortfolioDto } from './dto/reorder-portfolio.dto';
import { UpdatePortfolioCaptionDto } from './dto/update-portfolio-caption.dto';
import { UploadPortfolioItemDto } from './dto/upload-portfolio-item.dto';
import { PortfolioService, UploadedPortfolioFile } from './portfolio.service';

/**
 * Provider portfolio — the owner's `me` routes and the public list.
 *
 * ⚠️ `me/portfolio` AND `:id/portfolio` HAVE THE SAME SHAPE, so they live in
 * ONE controller with `me` declared FIRST. The other way round, `me` would be
 * captured as an `:id` and `ParseUUIDPipe` would answer 400 — same trap as
 * `GET /service-providers/me` vs `GET :id`.
 */
@ApiTags('portfolio')
@Controller('service-providers')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get('me/portfolio')
  @ApiOperation({
    summary:
      "The authenticated provider's live portfolio photos, in display order. 404 if the user has no provider.",
  })
  @ApiResponse({ status: 200, type: PortfolioItemListDto })
  @ApiResponse({ status: 404, description: 'The authenticated user has no provider.' })
  listMine(@CurrentUser() user: JwtPayload): Promise<PortfolioItemListDto> {
    return this.portfolio.listMine(user.sub);
  }

  @Post('me/portfolio')
  @ApiOperation({
    summary: `Add a photo (multipart: file + optional caption). JPEG, PNG or WebP still image, read from the bytes; at most ${PORTFOLIO_MAX_BYTES} bytes and ${PORTFOLIO_MAX_ITEMS} live photos. Re-encoded to WebP (≤ 1600 px, upright, no metadata).`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        caption: { type: 'string', maxLength: PORTFOLIO_CAPTION_MAX },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, type: PortfolioItemDto })
  @ApiResponse({ status: 400, description: 'No file, or caption too long.' })
  @ApiResponse({ status: 404, description: 'The authenticated user has no provider.' })
  @ApiResponse({
    status: 409,
    description: `Already ${PORTFOLIO_MAX_ITEMS} live photos. Body carries code PORTFOLIO_LIMIT_REACHED.`,
  })
  @ApiResponse({ status: 413, description: `File over ${PORTFOLIO_MAX_BYTES} bytes.` })
  @ApiResponse({
    status: 415,
    description: 'Not a JPEG, PNG or WebP still image (read from the bytes), or unreadable.',
  })
  @ApiResponse({ status: 422, description: 'Image over the pixel limit.' })
  @UseInterceptors(
    FileInterceptor('file', {
      // No `storage` → memory (file.buffer). `fileSize` makes multer stop
      // reading at the limit; Nest maps that error to 413 — BEFORE the whole
      // body is read. No `fileFilter` on the declared type on purpose: the type
      // is read from the bytes by the processor, never trusted from the client.
      //
      // ⚠️ `+ 1` IS NOT AN OFF-BY-ONE. busboy flags the limit as soon as the
      // byte count REACHES `fileSize` (it cannot know whether more is coming),
      // so `fileSize: MAX` would refuse a file of exactly MAX bytes. With
      // `MAX + 1`, MAX passes and MAX + 1 is a 413 — the same inclusive limit
      // as the processor's `> MAX`. Both ends are pinned by the controller spec.
      limits: { fileSize: PORTFOLIO_MAX_BYTES + 1, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UploadPortfolioItemDto,
    @UploadedFile() file: UploadedPortfolioFile | undefined,
  ): Promise<PortfolioItemDto> {
    return this.portfolio.upload(user.sub, file, dto.caption);
  }

  // Literal `order` BEFORE `:itemId` (different verb today, but kept first so a
  // future PATCH/DELETE on `order` cannot be captured as an id).
  @Put('me/portfolio/order')
  @ApiOperation({
    summary:
      'Reorder: ids must be EXACTLY the set of live photos, each once. Positions become 0..n-1.',
  })
  @ApiResponse({ status: 200, type: PortfolioItemListDto })
  @ApiResponse({ status: 400, description: 'ids is not an array of uuids.' })
  @ApiResponse({
    status: 422,
    description: 'An id is missing, extra, duplicated, deleted or someone else’s.',
  })
  reorder(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReorderPortfolioDto,
  ): Promise<PortfolioItemListDto> {
    return this.portfolio.reorder(user.sub, dto.ids);
  }

  @Patch('me/portfolio/:itemId')
  @ApiOperation({ summary: 'Set or clear the caption of one of your photos.' })
  @ApiResponse({ status: 200, type: PortfolioItemDto })
  @ApiResponse({ status: 400, description: 'Missing or too long caption.' })
  @ApiResponse({ status: 404, description: 'No such live photo of yours.' })
  updateCaption(
    @CurrentUser() user: JwtPayload,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdatePortfolioCaptionDto,
  ): Promise<PortfolioItemDto> {
    return this.portfolio.updateCaption(user.sub, itemId, dto.caption);
  }

  @Delete('me/portfolio/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete one of your photos: the row is soft-deleted AND the file is deleted.',
  })
  @ApiResponse({ status: 204, description: '' })
  @ApiResponse({ status: 404, description: 'No such live photo of yours.' })
  deleteMine(
    @CurrentUser() user: JwtPayload,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    return this.portfolio.deleteMine(user.sub, itemId);
  }

  @Public()
  @Get(':id/portfolio')
  @ApiOperation({
    summary:
      "A provider's live photos, public. 404 when the provider is not visible (same condition as GET /service-providers/:id). imageUrl is RELATIVE to the web origin.",
  })
  @ApiResponse({ status: 200, type: PublicPortfolioListDto })
  @ApiResponse({ status: 404, description: 'Provider not visible.' })
  listPublic(@Param('id', ParseUUIDPipe) id: string): Promise<PublicPortfolioListDto> {
    return this.portfolio.listPublic(id);
  }
}

/**
 * The image bytes, public. The web app relays it as `/media/portfolio/{id}`;
 * the browser never calls the API directly for an image.
 *
 * ⚠️ Headers are set by hand AFTER the photo is found, never by `@Header()`:
 * a `Cache-Control: public` must not ride on a 404.
 */
@ApiTags('portfolio')
@Controller('portfolio')
export class PortfolioImageController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Public()
  @Get(':itemId/image')
  @ApiOperation({
    summary:
      'Stream a live photo (image/webp). 404 when deleted or when the provider is not visible. Never redirects to storage.',
  })
  @ApiProduces('image/webp')
  @ApiResponse({ status: 200, description: 'The WebP bytes.' })
  @ApiResponse({ status: 404, description: 'No such visible photo.' })
  async image(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const image = await this.portfolio.getPublicImage(itemId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return new StreamableFile(image.stream, {
      type: image.contentType,
      length: image.byteSize,
    });
  }
}
