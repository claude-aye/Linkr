import { HttpException, HttpStatus } from '@nestjs/common';

/** 400 — invalid attachment file (disallowed mime type or size exceeded). */
export class InvalidAttachmentFileException extends HttpException {
  constructor(message = 'Invalid file: disallowed type or size exceeded') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

/**
 * 403 — the caller's role does not permit the requested attachment kind.
 * CLIENT_PHOTO is client-only; BEFORE/AFTER are worker-only.
 */
export class AttachmentKindForbiddenException extends HttpException {
  constructor(message = 'You are not allowed to upload this kind of attachment') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

/** 403 — the caller may not view/delete this request's attachments. */
export class AttachmentAccessForbiddenException extends HttpException {
  constructor(message = 'You are not allowed to access this attachment') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

/** 409 — attachments cannot be uploaded while the request is in a terminal-negative state. */
export class AttachmentRequestStateException extends HttpException {
  constructor(
    message = 'Attachments cannot be uploaded for a request in this state',
  ) {
    super(message, HttpStatus.CONFLICT);
  }
}
