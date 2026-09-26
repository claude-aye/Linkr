import {
  AcceptabilityProvider,
  AcceptabilityQuote,
  AcceptabilityRequest,
  QuoteAcceptabilityViolation as V,
  quoteAcceptabilityViolation,
} from './quote-acceptability';
import { QuoteStatus } from './enums/quote-status.enum';
import { ServiceRequestStatus } from '../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../service-requests/enums/service-request-type.enum';
import { ProviderType } from '../service-providers/enums/provider-type.enum';

/**
 * Truth table of the one rule shared by `accept` and the received-quotes list.
 * Pure: a frozen `now`, no mocks.
 */

const NOW = new Date('2026-09-20T12:00:00.000Z');

const request = (o: Partial<AcceptabilityRequest> = {}): AcceptabilityRequest => ({
  requestType: ServiceRequestType.PROJECT_TENDER,
  status: ServiceRequestStatus.OPEN,
  ...o,
});
const quote = (o: Partial<AcceptabilityQuote> = {}): AcceptabilityQuote => ({
  status: QuoteStatus.SUBMITTED,
  validUntilUtc: new Date(NOW.getTime() + 60_000),
  ...o,
});
const provider = (o: Partial<AcceptabilityProvider> = {}): AcceptabilityProvider => ({
  providerType: ProviderType.INDIVIDUAL,
  userId: 'user-1',
  isActive: true,
  deleted: false,
  chargesEnabled: true,
  ...o,
});

describe('quoteAcceptabilityViolation — truth table', () => {
  it('null when every condition holds', () => {
    expect(quoteAcceptabilityViolation(request(), quote(), provider(), NOW)).toBeNull();
  });

  it.each([
    ['a DIRECT_BOOKING', { requestType: ServiceRequestType.DIRECT_BOOKING }],
    ['an ASSIGNED tender', { status: ServiceRequestStatus.ASSIGNED }],
    ['an EXPIRED tender', { status: ServiceRequestStatus.EXPIRED }],
    ['a CANCELLED tender', { status: ServiceRequestStatus.CANCELLED }],
  ])('REQUEST_NOT_OPEN_TENDER on %s', (_label, o) => {
    expect(quoteAcceptabilityViolation(request(o), quote(), provider(), NOW)).toBe(
      V.REQUEST_NOT_OPEN_TENDER,
    );
  });

  it.each([QuoteStatus.ACCEPTED, QuoteStatus.REJECTED, QuoteStatus.WITHDRAWN, QuoteStatus.EXPIRED])(
    'QUOTE_NOT_SUBMITTED on a %s quote',
    (status) => {
      expect(quoteAcceptabilityViolation(request(), quote({ status }), provider(), NOW)).toBe(
        V.QUOTE_NOT_SUBMITTED,
      );
    },
  );

  it('QUOTE_EXPIRED at the exact millisecond of validUntilUtc (reached = too late)', () => {
    expect(
      quoteAcceptabilityViolation(request(), quote({ validUntilUtc: NOW }), provider(), NOW),
    ).toBe(V.QUOTE_EXPIRED);
  });

  it('not expired one millisecond before', () => {
    expect(
      quoteAcceptabilityViolation(
        request(),
        quote({ validUntilUtc: new Date(NOW.getTime() + 1) }),
        provider(),
        NOW,
      ),
    ).toBeNull();
  });

  it('QUOTE_EXPIRED on a SUBMITTED quote past its validity (the cron lag)', () => {
    expect(
      quoteAcceptabilityViolation(
        request(),
        quote({ validUntilUtc: new Date(NOW.getTime() - 3_600_000) }),
        provider(),
        NOW,
      ),
    ).toBe(V.QUOTE_EXPIRED);
  });

  it('PROVIDER_GONE when there is no provider row', () => {
    expect(quoteAcceptabilityViolation(request(), quote(), null, NOW)).toBe(V.PROVIDER_GONE);
  });

  it('PROVIDER_GONE when the provider is soft-deleted', () => {
    expect(
      quoteAcceptabilityViolation(request(), quote(), provider({ deleted: true }), NOW),
    ).toBe(V.PROVIDER_GONE);
  });

  it('PROVIDER_ORGANIZATION on an ORGANIZATION provider', () => {
    expect(
      quoteAcceptabilityViolation(
        request(),
        quote(),
        provider({ providerType: ProviderType.ORGANIZATION, userId: null }),
        NOW,
      ),
    ).toBe(V.PROVIDER_ORGANIZATION);
  });

  it('PROVIDER_ORGANIZATION on a provider with no user (the historical guard)', () => {
    expect(
      quoteAcceptabilityViolation(request(), quote(), provider({ userId: null }), NOW),
    ).toBe(V.PROVIDER_ORGANIZATION);
  });

  it('PROVIDER_PAUSED on a paused INDIVIDUAL provider', () => {
    expect(
      quoteAcceptabilityViolation(request(), quote(), provider({ isActive: false }), NOW),
    ).toBe(V.PROVIDER_PAUSED);
  });

  it('PROVIDER_NOT_CHARGEABLE when charges_enabled is false (or no Connect row)', () => {
    expect(
      quoteAcceptabilityViolation(request(), quote(), provider({ chargesEnabled: false }), NOW),
    ).toBe(V.PROVIDER_NOT_CHARGEABLE);
  });

  it('PROVIDER_NOT_CHARGEABLE when chargeability is unknown (partial double)', () => {
    const p = provider();
    delete (p as Partial<AcceptabilityProvider>).chargesEnabled;
    expect(quoteAcceptabilityViolation(request(), quote(), p, NOW)).toBe(
      V.PROVIDER_NOT_CHARGEABLE,
    );
  });

  describe('order — the first failing rule wins, in the historical guard order', () => {
    it('request before quote', () => {
      expect(
        quoteAcceptabilityViolation(
          request({ status: ServiceRequestStatus.ASSIGNED }),
          quote({ status: QuoteStatus.REJECTED }),
          null,
          NOW,
        ),
      ).toBe(V.REQUEST_NOT_OPEN_TENDER);
    });

    it('quote status before expiry', () => {
      expect(
        quoteAcceptabilityViolation(
          request(),
          quote({ status: QuoteStatus.REJECTED, validUntilUtc: NOW }),
          provider(),
          NOW,
        ),
      ).toBe(V.QUOTE_NOT_SUBMITTED);
    });

    it('expiry before the provider', () => {
      expect(
        quoteAcceptabilityViolation(request(), quote({ validUntilUtc: NOW }), null, NOW),
      ).toBe(V.QUOTE_EXPIRED);
    });

    it('gone before organization and pause', () => {
      expect(
        quoteAcceptabilityViolation(
          request(),
          quote(),
          provider({ deleted: true, providerType: ProviderType.ORGANIZATION, isActive: false }),
          NOW,
        ),
      ).toBe(V.PROVIDER_GONE);
    });

    it('a PAUSED ORGANIZATION stays PROVIDER_ORGANIZATION (keeps its historical 501)', () => {
      expect(
        quoteAcceptabilityViolation(
          request(),
          quote(),
          provider({ providerType: ProviderType.ORGANIZATION, userId: null, isActive: false }),
          NOW,
        ),
      ).toBe(V.PROVIDER_ORGANIZATION);
    });

    // PROVIDER_NOT_CHARGEABLE is LAST: before it existed, `assertPayable`
    // refused it after every other check. Each earlier reason keeps its code.
    it.each<[string, () => V | null, V]>([
      ['expired', () => quoteAcceptabilityViolation(request(), quote({ validUntilUtc: NOW }), provider({ chargesEnabled: false }), NOW), V.QUOTE_EXPIRED],
      ['deleted', () => quoteAcceptabilityViolation(request(), quote(), provider({ deleted: true, chargesEnabled: false }), NOW), V.PROVIDER_GONE],
      ['organization', () => quoteAcceptabilityViolation(request(), quote(), provider({ providerType: ProviderType.ORGANIZATION, userId: null, chargesEnabled: false }), NOW), V.PROVIDER_ORGANIZATION],
      ['paused', () => quoteAcceptabilityViolation(request(), quote(), provider({ isActive: false, chargesEnabled: false }), NOW), V.PROVIDER_PAUSED],
    ])('%s AND not chargeable → the earlier reason wins', (_label, run, expected) => {
      expect(run()).toBe(expected);
    });
  });
});
