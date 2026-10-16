import { Injectable } from '@nestjs/common';
// `import = require`: sharp is a CommonJS `export =` function, and this
// tsconfig has no `esModuleInterop` — a default import would compile to
// `sharp_1.default`, which is undefined at runtime.
import sharp = require('sharp');
import {
  PORTFOLIO_ACCEPTED_FORMATS,
  PORTFOLIO_CONTENT_TYPE,
  PORTFOLIO_MAX_BYTES,
  PORTFOLIO_MAX_INPUT_PIXELS,
  PORTFOLIO_OUTPUT_MAX_SIDE,
  PORTFOLIO_WEBP_QUALITY,
} from './constants';
import {
  PortfolioFileTooLargeException,
  PortfolioImageTooManyPixelsException,
  PortfolioUnsupportedImageException,
} from './exceptions/portfolio-exceptions';

/** What is stored: the re-encoded file and its own facts — never the upload's. */
export interface ProcessedPortfolioImage {
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
  byteSize: number;
}

/**
 * Turns an uploaded file into the only thing a portfolio ever stores: a WebP of
 * at most 1600 px on its longest side, upright, with NO metadata.
 *
 * Isolated from HTTP and storage on purpose, so it is tested alone on images
 * generated in the test itself. The steps run in this order, and the order is
 * the contract — each one decides which status a bad file gets:
 *
 *   1. size        → 413 (defensive: multer has already refused it)
 *   2. real format → 415, read from the BYTES by `metadata()`; the extension
 *                    and the declared Content-Type are never consulted
 *   3. pixel count → 422, decided on the header before a single pixel is decoded
 *   4. re-encode
 *
 * ⚠️ `.rotate()` WITHOUT ARGUMENT, BEFORE `resize`. Stripping metadata also
 * strips the EXIF orientation tag, so it must be APPLIED to the pixels first:
 * without it, every portrait photo taken on a phone is stored lying on its side.
 * A test pins this (800×600 tagged orientation 6 → 600×800), and fails when the
 * call is removed.
 *
 * ⚠️ NEVER `.withMetadata()`, `.keepExif()`, `.keepMetadata()` OR ANY `keep*`.
 * sharp writes no metadata unless asked to, and that default is the whole Loi 25
 * guarantee of this feature: a phone photo carries the GPS position of where it
 * was taken — often the provider's home. A test pins that the output has no EXIF.
 */
@Injectable()
export class PortfolioImageProcessor {
  async process(input: Buffer): Promise<ProcessedPortfolioImage> {
    // 1. Size.
    if (input.length > PORTFOLIO_MAX_BYTES) {
      throw new PortfolioFileTooLargeException();
    }

    // 2. Real format, from the bytes. `limitInputPixels: false` HERE ONLY:
    //    reading the header decodes no pixel, and keeping the limit would make
    //    an oversized image fail as « unreadable » (415) instead of reaching
    //    the explicit pixel check below (422).
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(input, { limitInputPixels: false }).metadata();
    } catch {
      throw new PortfolioUnsupportedImageException();
    }
    if (!metadata.format || !PORTFOLIO_ACCEPTED_FORMATS.includes(metadata.format)) {
      throw new PortfolioUnsupportedImageException();
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new PortfolioUnsupportedImageException('Animated images are not accepted');
    }

    // 3. Decompression-bomb guard, on the header's dimensions.
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width <= 0 || height <= 0) {
      throw new PortfolioUnsupportedImageException();
    }
    if (width * height > PORTFOLIO_MAX_INPUT_PIXELS) {
      throw new PortfolioImageTooManyPixelsException();
    }

    // 4. Re-encode. The pipeline keeps its own pixel limit as a backstop.
    let output: { data: Buffer; info: sharp.OutputInfo };
    try {
      output = await sharp(input, { limitInputPixels: PORTFOLIO_MAX_INPUT_PIXELS })
        .rotate()
        .resize({
          width: PORTFOLIO_OUTPUT_MAX_SIDE,
          height: PORTFOLIO_OUTPUT_MAX_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: PORTFOLIO_WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
    } catch (err) {
      if (err instanceof Error && /pixel limit/i.test(err.message)) {
        throw new PortfolioImageTooManyPixelsException();
      }
      // A header that parsed but pixels that do not decode (truncated file…).
      throw new PortfolioUnsupportedImageException();
    }

    return {
      buffer: output.data,
      contentType: PORTFOLIO_CONTENT_TYPE,
      width: output.info.width,
      height: output.info.height,
      byteSize: output.data.length,
    };
  }
}
