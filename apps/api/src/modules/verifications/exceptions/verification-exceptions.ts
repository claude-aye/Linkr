import { HttpException, HttpStatus } from '@nestjs/common';

/** 422 — documentType does not match the requirement's required_document_type. */
export class DocumentTypeMismatchException extends HttpException {
  constructor(
    message = 'documentType does not match the regulatory requirement',
  ) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** 422 — requirement not in the PSC category, or outside the provider jurisdiction. */
export class RequirementNotInScopeException extends HttpException {
  constructor(
    message = 'The regulatory requirement is not in scope for this provider category',
  ) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** 422 — uploading proof for an INFORMAL category (no documents required). */
export class CategoryNotRegulatedException extends HttpException {
  constructor(
    message = 'This service category is not regulated; no documents are required',
  ) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** 400 — invalid file (disallowed mime type or size exceeded). */
export class InvalidFileException extends HttpException {
  constructor(message = 'Invalid file: disallowed type or size exceeded') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}
