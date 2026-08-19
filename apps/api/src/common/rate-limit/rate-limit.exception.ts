import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 429 — the caller spent its budget for the current window.
 *
 * The message is English, like every other API-side message
 * (`Admin access required`, `This search is not empty …`), and unlike the
 * geocoding 502, which is French precisely because the front shows it verbatim.
 * Nothing shows this one: the only caller today is a fire-and-forget island that
 * ignores the outcome, so the string exists for logs and for whoever reads the
 * response by hand.
 */
export class RateLimitExceededException extends HttpException {
  constructor(message = 'Too many requests — slow down and try again later') {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
