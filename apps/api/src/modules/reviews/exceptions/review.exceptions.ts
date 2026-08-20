import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 409 — the request has not reached COMPLETED, so there is nothing to review yet.
 *
 * The gate is D-1 and it is what makes a review unfalsifiable: reaching
 * COMPLETED takes an assignment, a provider marking the job done, and a state
 * machine that refuses shortcuts.
 */
export class ReviewRequiresCompletedRequestException extends HttpException {
  constructor(
    message = 'A review can only be written once the request is COMPLETED',
  ) {
    super(message, HttpStatus.CONFLICT);
  }
}

/**
 * 409 — this request already carries a live review.
 *
 * ⚠️ THIS IS A DOOR, NOT A WALL, AND THE DIFFERENCE IS THE WHOLE POINT OF THE
 * PARTIAL UNIQUE INDEX. Editing is forbidden (D-3), but the author may delete
 * their review and write a new one — `DELETE /reviews/:id` frees the slot
 * because the index is partial on `deleted_at_utc IS NULL`. Contrast with
 * `ux_psc_provider_category_active`, whose identical shape IS a dead end
 * (session 4): there, nothing offers the deletion that would free the slot.
 */
export class ReviewAlreadyExistsException extends HttpException {
  constructor(
    message = 'This request already has a review — delete it before writing a new one',
  ) {
    super(message, HttpStatus.CONFLICT);
  }
}

/**
 * 409 — the request reached COMPLETED with no assigned provider.
 *
 * Defensive: the state machine cannot produce it (COMPLETED is downstream of
 * ASSIGNED, which fills the column). But `assigned_service_provider_id` is
 * nullable, so the code handles it instead of asserting it away — a review has
 * to have a subject, and inventing one is not an option.
 */
export class ReviewSubjectMissingException extends HttpException {
  constructor(
    message = 'The request has no assigned provider to review',
  ) {
    super(message, HttpStatus.CONFLICT);
  }
}
