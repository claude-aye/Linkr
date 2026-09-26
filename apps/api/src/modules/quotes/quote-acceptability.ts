import { QuoteStatus } from './enums/quote-status.enum';
import { ServiceRequestStatus } from '../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../service-requests/enums/service-request-type.enum';
import { ProviderType } from '../service-providers/enums/provider-type.enum';

/**
 * Why a quote cannot be accepted right now — or `null` when it can.
 *
 * ⚠️ ONE FUNCTION, TWO READERS, AND THAT IS THE POINT. `QuotesService.accept`
 * calls it on the LOCKED records and turns each reason into its HTTP exception;
 * the client's received-quotes list calls it on every row and exposes
 * `acceptable = violation === null`. A list that computed `acceptable` on its
 * own would drift from what `accept` actually allows — and the drift has no
 * symptom until a client clicks a button the list said was live and gets a 409.
 *
 * ⚠️ THE ORDER IS THE CONTRACT. It follows the order of the guards `accept` had
 * before this function existed, so no existing case changes its HTTP code.
 * Reasons added since are appended, each AFTER every reason that used to
 * answer before it:
 *   - PROVIDER_PAUSED (PR 4a) after PROVIDER_ORGANIZATION, so a paused
 *     ORGANIZATION provider keeps answering 501 instead of switching to 409;
 *   - PROVIDER_NOT_CHARGEABLE (PR 4a-bis) LAST: before it existed, that
 *     refusal came from `assertPayable` inside `assignIndividualProvider`,
 *     i.e. after EVERY check here. A deleted / expired / organization / paused
 *     case keeps its own code; only a quote that passes all of them reaches
 *     this one, and gets the SAME 409 (`ProviderNotChargeableException`).
 *
 * Owner checks and "not found" on the quote or the request are NOT here: they
 * are about who is asking and what exists, not about whether this quote can be
 * accepted. Each caller keeps them.
 */
export enum QuoteAcceptabilityViolation {
  REQUEST_NOT_OPEN_TENDER = 'REQUEST_NOT_OPEN_TENDER',
  QUOTE_NOT_SUBMITTED = 'QUOTE_NOT_SUBMITTED',
  QUOTE_EXPIRED = 'QUOTE_EXPIRED',
  PROVIDER_GONE = 'PROVIDER_GONE',
  PROVIDER_ORGANIZATION = 'PROVIDER_ORGANIZATION',
  PROVIDER_PAUSED = 'PROVIDER_PAUSED',
  PROVIDER_NOT_CHARGEABLE = 'PROVIDER_NOT_CHARGEABLE',
}

export interface AcceptabilityRequest {
  requestType: ServiceRequestType;
  status: ServiceRequestStatus;
}

export interface AcceptabilityQuote {
  status: QuoteStatus;
  validUntilUtc: Date;
}

/**
 * The quote's provider. `null` = no row at all; `deleted` = a row that is
 * soft-deleted. Both mean gone. `deleted` is REQUIRED so every caller has to
 * say which case it is in — `accept` reads through `findById`, which already
 * filters soft-deleted rows, while the list deliberately does not.
 */
export interface AcceptabilityProvider {
  providerType: ProviderType;
  userId: string | null;
  isActive: boolean;
  deleted: boolean;
  /**
   * Connect mirror row exists AND `charges_enabled`; no row ⇒ false. REQUIRED
   * for the same reason as `deleted`: each caller must say where it read it.
   */
  chargesEnabled: boolean;
}

export function quoteAcceptabilityViolation(
  request: AcceptabilityRequest,
  quote: AcceptabilityQuote,
  provider: AcceptabilityProvider | null,
  now: Date,
): QuoteAcceptabilityViolation | null {
  if (
    request.requestType !== ServiceRequestType.PROJECT_TENDER ||
    request.status !== ServiceRequestStatus.OPEN
  ) {
    return QuoteAcceptabilityViolation.REQUEST_NOT_OPEN_TENDER;
  }

  // SUBMITTED is the only state the quote state machine lets reach ACCEPTED.
  if (quote.status !== QuoteStatus.SUBMITTED) {
    return QuoteAcceptabilityViolation.QUOTE_NOT_SUBMITTED;
  }

  // Reached ⇒ expired: the exact millisecond of `valid_until_utc` is too late.
  // A SUBMITTED quote can be past it for up to an hour — the cron flips it to
  // EXPIRED on its own schedule — which is exactly why this is read here and
  // not inferred from the status.
  if (new Date(quote.validUntilUtc).getTime() <= now.getTime()) {
    return QuoteAcceptabilityViolation.QUOTE_EXPIRED;
  }

  if (provider === null || provider.deleted) {
    return QuoteAcceptabilityViolation.PROVIDER_GONE;
  }

  if (provider.providerType === ProviderType.ORGANIZATION || provider.userId === null) {
    return QuoteAcceptabilityViolation.PROVIDER_ORGANIZATION;
  }

  // A paused provider is invisible to discovery and gets an empty tender feed
  // (PR 2). Letting a client assign him a job — and capture a deposit to him —
  // through a quote sent before the pause would contradict both.
  //
  // `=== false`, not `!isActive`: the column is `boolean NOT NULL`, so the two
  // are the same on a real row; this form only differs on a partial test
  // double, where "unknown" must not read as "paused".
  if (provider.isActive === false) {
    return QuoteAcceptabilityViolation.PROVIDER_PAUSED;
  }

  // Without charges_enabled the deposit cannot be taken: `assertPayable`
  // refuses the assignment (409) inside `accept`. Without this reason the list
  // would show a live "Accept" that answers 409.
  //
  // ⚠️ The CLIENT's default card — the other half of `assertPayable` — is NOT
  // here and must not be: it is a condition on the client, not on the quote.
  // It holds or fails for every quote of the list at once; the screen handles
  // it itself.
  //
  // `!== true`, not `=== false`: unlike `isActive`, "unknown" must read as
  // "cannot be charged" — no Connect row already means false upstream.
  if (provider.chargesEnabled !== true) {
    return QuoteAcceptabilityViolation.PROVIDER_NOT_CHARGEABLE;
  }

  return null;
}
