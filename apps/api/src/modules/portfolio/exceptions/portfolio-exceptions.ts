import { HttpException, HttpStatus } from '@nestjs/common';
import {
  PORTFOLIO_MAX_BYTES,
  PORTFOLIO_MAX_INPUT_PIXELS,
  PORTFOLIO_MAX_ITEMS,
} from '../constants';

/**
 * 413 — the upload is larger than PORTFOLIO_MAX_BYTES. The multipart parser
 * normally refuses it first (multer `limits.fileSize`, mapped by Nest to the
 * same status); this one is the processor's own defensive copy.
 */
export class PortfolioFileTooLargeException extends HttpException {
  constructor() {
    super(
      `The file exceeds the ${PORTFOLIO_MAX_BYTES} byte limit`,
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
}

/**
 * 415 — the bytes are not a JPEG, PNG or WebP image (whatever the extension or
 * the declared Content-Type), are unreadable, or are animated.
 */
export class PortfolioUnsupportedImageException extends HttpException {
  constructor(message = 'Only JPEG, PNG and WebP still images are accepted') {
    super(message, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
  }
}

/** 422 — width × height exceeds PORTFOLIO_MAX_INPUT_PIXELS (decompression-bomb guard). */
export class PortfolioImageTooManyPixelsException extends HttpException {
  constructor() {
    super(
      `The image exceeds ${PORTFOLIO_MAX_INPUT_PIXELS} pixels`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 400 — the multipart request carries no `file` part. */
export class PortfolioFileMissingException extends HttpException {
  constructor() {
    super('No file provided (multipart field "file")', HttpStatus.BAD_REQUEST);
  }
}

/** Machine-readable code of the 409 below. Part of the contract: P2 maps on it. */
export const PORTFOLIO_LIMIT_REACHED = 'PORTFOLIO_LIMIT_REACHED';

/**
 * 409 — the provider already has PORTFOLIO_MAX_ITEMS live photos.
 *
 * The body carries an explicit `code` next to the usual Nest fields. It is the
 * first `code` in this API: a 409 can mean several things elsewhere (lock 3.12b
 * maps by status alone), and this one deserves to be told apart.
 */
export class PortfolioLimitReachedException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: PORTFOLIO_LIMIT_REACHED,
        message: `A portfolio holds at most ${PORTFOLIO_MAX_ITEMS} photos; delete one first`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — the reorder list is not EXACTLY the set of the provider's live photos
 * (an id missing, extra, duplicated, deleted, or belonging to someone else).
 */
export class PortfolioOrderMismatchException extends HttpException {
  constructor() {
    super(
      'ids must list every live portfolio photo of this provider exactly once',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
