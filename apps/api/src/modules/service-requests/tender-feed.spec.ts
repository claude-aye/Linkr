import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProviderServiceRequestsController } from './provider-service-requests.controller';
import { ServiceRequestsService } from './service-requests.service';
import { ServiceProvidersService } from '../service-providers/service-providers.service';
import { ProviderTenderItemDto } from './dto/provider-tender-item.dto';
import type { ProviderTenderRecord } from './repositories/service-request.repository';
import { QuoteStatus } from '../quotes/enums/quote-status.enum';
import {
  ELIGIBILITY_CATEGORY_FROM_PARAM,
  ELIGIBILITY_CATEGORY_FROM_TENDER,
  ELIGIBILITY_POINT_FROM_PARAMS,
  ELIGIBILITY_POINT_FROM_TENDER,
  eligibilityFromWhere,
} from '../service-providers/repositories/eligibility.sql';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

/**
 * ⚠️ WHAT THIS FILE CANNOT PROVE, SAID PLAINLY.
 *
 * The feed's membership rule is a SQL truth table — a correlated EXISTS over
 * three tables, two PostGIS predicates and a LATERAL. No mock reproduces that,
 * and a test asserting on a hand-written query string would only assert that
 * the string had not changed: not the same fact, and green on a query that
 * returns the wrong rows. Same position R7 took for the expiry sweep.
 *
 * The truth table is therefore exercised against a real Postgres by the probe
 * shipped with this PR (src/database/probes/tender-feed.probe.ts), which calls
 * the shipped repository method rather than a copy of its SQL. What is pinned
 * HERE is everything that lives in TypeScript and that a mock CAN reach: the
 * controller wiring, the mapper, and the construction of the shared fragment.
 */

const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';
const OWNER = {
  sub: '55555555-5555-4555-8555-555555555555',
  email: 'pro@linkr.test',
  type: 'access',
} as unknown as JwtPayload;

function tenderRecord(
  overrides: Partial<ProviderTenderRecord> = {},
): ProviderTenderRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Refaire la salle de bain',
    description: 'Description.',
    serviceCategoryId: '44444444-4444-4444-8444-444444444444',
    serviceCategoryNameTranslations: { 'fr-CA': 'Plomberie' },
    desiredStartAtUtc: null,
    desiredEndAtUtc: null,
    estimatedAmount: null,
    estimatedCurrency: null,
    quotesDeadlineUtc: new Date(Date.UTC(2026, 8, 30, 14, 0, 0)),
    createdAtUtc: new Date(Date.UTC(2026, 8, 23, 9, 0, 0)),
    distanceMeters: 0,
    myQuoteId: null,
    myQuoteStatus: null,
    ...overrides,
  };
}

describe('Tender feed — controller wiring', () => {
  let providersService: { loadOwnedProvider: jest.Mock };
  let requestsService: { listTendersForProvider: jest.Mock };
  let controller: ProviderServiceRequestsController;

  beforeEach(() => {
    providersService = { loadOwnedProvider: jest.fn().mockResolvedValue({}) };
    requestsService = {
      listTendersForProvider: jest
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    };
    controller = new ProviderServiceRequestsController(
      providersService as unknown as ServiceProvidersService,
      requestsService as unknown as ServiceRequestsService,
    );
  });

  it('checks ownership BEFORE reading the feed', async () => {
    await controller.listTenders(OWNER, PROVIDER_ID, {});

    expect(providersService.loadOwnedProvider).toHaveBeenCalledWith(
      OWNER.sub,
      PROVIDER_ID,
    );
    // Order, not merely presence: a feed read that started before the guard
    // resolved would leak a provider's tenders on the way to a 403.
    expect(
      providersService.loadOwnedProvider.mock.invocationCallOrder[0],
    ).toBeLessThan(
      requestsService.listTendersForProvider.mock.invocationCallOrder[0],
    );
  });

  it('propagates the 404 and never reads the feed', async () => {
    providersService.loadOwnedProvider.mockRejectedValue(
      new NotFoundException('Service provider not found'),
    );

    await expect(
      controller.listTenders(OWNER, PROVIDER_ID, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(requestsService.listTendersForProvider).not.toHaveBeenCalled();
  });

  it('propagates the 403 and never reads the feed', async () => {
    providersService.loadOwnedProvider.mockRejectedValue(
      new ForbiddenException('You do not own this service provider'),
    );

    await expect(
      controller.listTenders(OWNER, PROVIDER_ID, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(requestsService.listTendersForProvider).not.toHaveBeenCalled();
  });

  it('passes the pagination query through untouched', async () => {
    await controller.listTenders(OWNER, PROVIDER_ID, { page: 3, limit: 50 });

    expect(requestsService.listTendersForProvider).toHaveBeenCalledWith(
      PROVIDER_ID,
      { page: 3, limit: 50 },
    );
  });
});

describe('Tender feed — item mapper', () => {
  // Metres to whole kilometres. The boundaries are what matter: 499 m must not
  // become 1 km, and 500 m must not stay 0.
  it.each([
    [0, 0],
    [400, 0],
    [499, 0],
    [500, 1],
    [1_400, 1],
    [1_500, 2],
    [12_345.678, 12],
  ])('rounds %d m to %d km', (metres, km) => {
    expect(
      ProviderTenderItemDto.from(tenderRecord({ distanceMeters: metres }))
        .distanceKm,
    ).toBe(km);
  });

  it('carries a missing quote as null on BOTH fields', () => {
    const dto = ProviderTenderItemDto.from(tenderRecord());
    expect(dto.myQuoteId).toBeNull();
    expect(dto.myQuoteStatus).toBeNull();
  });

  it('keeps a WITHDRAWN quote visible — the provider may quote again', () => {
    const dto = ProviderTenderItemDto.from(
      tenderRecord({
        myQuoteId: '66666666-6666-4666-8666-666666666666',
        myQuoteStatus: QuoteStatus.WITHDRAWN,
      }),
    );
    expect(dto.myQuoteStatus).toBe(QuoteStatus.WITHDRAWN);
  });

  it('never exposes an address, a coordinate or the client', () => {
    const dto = ProviderTenderItemDto.from(tenderRecord()) as unknown as Record<
      string,
      unknown
    >;
    for (const forbidden of [
      'serviceAddress',
      'serviceLocation',
      'serviceLocationPrecision',
      'clientUserId',
      'clientDisplayName',
      'distanceMeters',
    ]) {
      expect(Object.keys(dto)).not.toContain(forbidden);
    }
  });

  it('falls back to an empty label map rather than crashing on a missing join', () => {
    const dto = ProviderTenderItemDto.from(
      tenderRecord({
        serviceCategoryNameTranslations: null as unknown as Record<
          string,
          string
        >,
      }),
    );
    expect(dto.serviceCategoryNameTranslations).toEqual({});
  });
});

describe('Tender feed — the shared eligibility fragment', () => {
  const pointToProviders = eligibilityFromWhere(
    ELIGIBILITY_POINT_FROM_PARAMS,
    ELIGIBILITY_CATEGORY_FROM_PARAM,
  );
  const providerToTenders = eligibilityFromWhere(
    ELIGIBILITY_POINT_FROM_TENDER,
    ELIGIBILITY_CATEGORY_FROM_TENDER,
  );

  it('states the coverage rule identically in both directions', () => {
    // Everything but the two interpolated expressions must be the same text. A
    // rule added to one reading only shows up right here.
    const normalise = (sql: string): string =>
      sql
        .split(ELIGIBILITY_POINT_FROM_PARAMS)
        .join('<POINT>')
        .split(ELIGIBILITY_POINT_FROM_TENDER)
        .join('<POINT>')
        .replace(
          `psc.service_category_id = ${ELIGIBILITY_CATEGORY_FROM_PARAM}`,
          'psc.service_category_id = <CATEGORY>',
        )
        .replace(
          `psc.service_category_id = ${ELIGIBILITY_CATEGORY_FROM_TENDER}`,
          'psc.service_category_id = <CATEGORY>',
        );

    expect(normalise(providerToTenders)).toBe(normalise(pointToProviders));
  });

  it.each([
    [
      'the trade claim is live',
      "psc.verification_status IN ('VERIFIED', 'NOT_REQUIRED')",
    ],
    ['the trade claim is active', 'psc.is_active = true'],
    ['the trade claim is not soft-deleted', 'psc.deleted_at_utc IS NULL'],
    ['the provider is active', 'sp.is_active = true'],
    ['the provider is not soft-deleted', 'sp.deleted_at_utc IS NULL'],
    ['the radius branch exists', 'ST_DWithin(sp.service_base_location'],
    ['the zone branch exists', 'ST_Covers(z.zone_polygon'],
    ['zones are not soft-deleted', 'z.deleted_at_utc IS NULL'],
  ])('keeps "%s" in both readings', (_label, clause) => {
    expect(pointToProviders).toContain(clause);
    expect(providerToTenders).toContain(clause);
  });

  it('casts the tender point to geography', () => {
    // Without the cast the geometry overload of ST_DWithin applies and the
    // radius is read in DEGREES — a wrong answer, not an error.
    expect(providerToTenders).toContain('sr.service_location::geography');
    expect(providerToTenders).not.toMatch(/sr\.service_location(?!::geography)/);
  });

  it('binds no parameter in the provider-to-tenders reading', () => {
    // Both expressions are column references, so an embedding query is free to
    // number its own placeholders from $1.
    expect(providerToTenders).not.toMatch(/\$\d/);
    expect(pointToProviders).toMatch(/\$1/);
  });

  it('declares no alias the tender feed already uses', () => {
    // The feed correlates back to `sr` from inside the EXISTS and names the
    // calling provider `me`; reusing either here would shadow it and turn the
    // EXISTS into a tautology. `o` left with the organizations join.
    const declared = [
      ...providerToTenders.matchAll(/\b(?:FROM|JOIN)\s+(\w+)\s+(\w+)/g),
    ].map((m) => m[2]);

    expect([...declared].sort()).toEqual(['psc', 'sp', 'z']);
    for (const hostAlias of ['sr', 'sc', 'mq', 'me', 'q', 'o']) {
      expect(declared).not.toContain(hostAlias);
    }
  });
});
