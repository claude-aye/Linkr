import { resolveAgreedPrice, AgreedPriceRequest } from './agreed-price';
import { ServiceRequestType } from './enums/service-request-type.enum';

const ACCEPTED_AT = new Date('2026-09-20T15:00:00Z');
const QUOTE = { amount: '250.00', currency: 'CAD' };

const request = (over: Partial<AgreedPriceRequest>): AgreedPriceRequest => ({
  requestType: ServiceRequestType.DIRECT_BOOKING,
  acceptedAtUtc: ACCEPTED_AT,
  estimatedAmount: '150.00',
  estimatedCurrency: 'CAD',
  ...over,
});

const NONE = { agreedAmount: null, agreedCurrency: null };

describe('resolveAgreedPrice', () => {
  it('is null while the request has not been accepted (DIRECT_BOOKING)', () => {
    expect(resolveAgreedPrice(request({ acceptedAtUtc: null }), null)).toEqual(NONE);
  });

  it('is null while the request has not been accepted (PROJECT_TENDER)', () => {
    expect(
      resolveAgreedPrice(
        request({ requestType: ServiceRequestType.PROJECT_TENDER, acceptedAtUtc: null }),
        null,
      ),
    ).toEqual(NONE);
  });

  it('a direct booking, once accepted, is its own estimate', () => {
    expect(resolveAgreedPrice(request({}), null)).toEqual({
      agreedAmount: '150.00',
      agreedCurrency: 'CAD',
    });
  });

  it('a direct booking accepted with a null estimate has no agreed price', () => {
    expect(
      resolveAgreedPrice(request({ estimatedAmount: null, estimatedCurrency: null }), null),
    ).toEqual(NONE);
  });

  it('a direct booking ignores an accepted quote — the estimate is what is charged', () => {
    expect(resolveAgreedPrice(request({}), QUOTE)).toEqual({
      agreedAmount: '150.00',
      agreedCurrency: 'CAD',
    });
  });

  it('an accepted tender is the QUOTE, never the client budget', () => {
    expect(
      resolveAgreedPrice(
        request({
          requestType: ServiceRequestType.PROJECT_TENDER,
          estimatedAmount: '1500.00', // the client's indicative budget
        }),
        QUOTE,
      ),
    ).toEqual({ agreedAmount: '250.00', agreedCurrency: 'CAD' });
  });

  it('an accepted tender with no ACCEPTED quote is null — the budget is not a fallback', () => {
    expect(
      resolveAgreedPrice(
        request({
          requestType: ServiceRequestType.PROJECT_TENDER,
          estimatedAmount: '1500.00',
        }),
        null,
      ),
    ).toEqual(NONE);
  });

  it('a tender that was NOT accepted stays null even if an ACCEPTED quote is supplied', () => {
    // Inconsistent input: acceptedAtUtc governs.
    expect(
      resolveAgreedPrice(
        request({ requestType: ServiceRequestType.PROJECT_TENDER, acceptedAtUtc: null }),
        QUOTE,
      ),
    ).toEqual(NONE);
  });

  it('amount and currency travel as a pair', () => {
    const r = resolveAgreedPrice(request({ estimatedCurrency: null }), null);
    expect(r).toEqual(NONE);
  });
});
