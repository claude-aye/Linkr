import 'reflect-metadata';
import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EMAIL_NOT_VERIFIED } from '../../modules/auth/email-verification.exceptions';
import { UsersRepository } from '../../modules/users/users.repository';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { OrganizationRoleGuard } from '../../modules/organization-memberships/guards/organization-role.guard';
import { ReviewsController } from '../../modules/reviews/reviews.controller';
import { ReviewsService } from '../../modules/reviews/reviews.service';
import { ServiceRequestAttachmentsController } from '../../modules/service-requests/service-request-attachments.controller';
import { ServiceRequestAttachmentsService } from '../../modules/service-requests/service-request-attachments.service';
import { ServiceZonesController } from '../../modules/service-providers/service-zones.controller';
import { ServiceProvidersService } from '../../modules/service-providers/service-providers.service';
import { ServiceItemSuggestionController } from '../../modules/services-catalog/services-catalog.controller';
import { ServicesCatalogService } from '../../modules/services-catalog/services-catalog.service';
import { OrganizationsController } from '../../modules/organizations/organizations.controller';
import { OrganizationsService } from '../../modules/organizations/organizations.service';
import { OrganizationMembershipsController } from '../../modules/organization-memberships/organization-memberships.controller';
import { OrganizationMembershipsService } from '../../modules/organization-memberships/organization-memberships.service';

/**
 * L3b-A — behaviour of the 7 newly guarded routes: an UNCONFIRMED caller gets
 * 403 EMAIL_NOT_VERIFIED BEFORE the business layer is reached (so before any
 * business 404/403), and a CONFIRMED caller reaches the handler unchanged.
 *
 * The services are doubles that record calls; the real `EmailVerifiedGuard` is
 * exercised through the real decorator. `RateLimitGuard` and
 * `OrganizationRoleGuard` are stubbed open: on the membership routes the role
 * guard is class-level, so it runs BEFORE the method-level email guard
 * (Nest order) — it is a membership check, not a business 404/403 on the
 * target, and its own behaviour is outside this spec.
 */
const UUID = '6b0c3a0e-1111-4c3e-9d77-000000000001';
const UUID2 = '6b0c3a0e-1111-4c3e-9d77-000000000002';

const open: CanActivate = { canActivate: () => true };
const fakeJwt: CanActivate = {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().user = { sub: UUID, email: 'x@linkr.test', type: 'access' };
    return true;
  },
};

const business = jest.fn().mockResolvedValue({ ok: true });
const doubleService = () =>
  // `then` must stay undefined: Nest awaits provider values, and a callable `then` never settles.
  new Proxy({}, { get: (_t, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : business) }) as unknown;

interface Case {
  name: string;
  method: 'post' | 'put';
  url: string;
  body?: Record<string, unknown>;
  attach?: boolean;
}

const CASES: Case[] = [
  { name: 'POST /reviews/:id/response', method: 'post', url: `/reviews/${UUID}/response`, body: { response: 'Merci' } },
  { name: 'POST /service-requests/:id/attachments', method: 'post', url: `/service-requests/${UUID}/attachments`, attach: true },
  { name: 'POST /service-providers/:id/zones', method: 'post', url: `/service-providers/${UUID}/zones`, body: {} },
  { name: 'POST /service-items/suggest', method: 'post', url: '/service-items/suggest', body: {} },
  { name: 'POST /organizations', method: 'post', url: '/organizations', body: {} },
  { name: 'POST /organizations/:orgId/members', method: 'post', url: `/organizations/${UUID}/members`, body: {} },
  { name: 'PUT …/members/:membershipId/role', method: 'put', url: `/organizations/${UUID}/members/${UUID2}/role`, body: {} },
];

describe('L3b-A — the 7 newly guarded routes', () => {
  let app: INestApplication;
  let verified: Date | null = null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        ReviewsController,
        ServiceRequestAttachmentsController,
        ServiceZonesController,
        ServiceItemSuggestionController,
        OrganizationsController,
        OrganizationMembershipsController,
      ],
      providers: [
        { provide: APP_GUARD, useValue: fakeJwt },
        { provide: ReviewsService, useValue: doubleService() },
        { provide: ServiceRequestAttachmentsService, useValue: doubleService() },
        { provide: ServiceProvidersService, useValue: doubleService() },
        { provide: ServicesCatalogService, useValue: doubleService() },
        { provide: OrganizationsService, useValue: doubleService() },
        { provide: OrganizationMembershipsService, useValue: doubleService() },
        {
          provide: UsersRepository,
          useValue: { findById: jest.fn(async () => ({ id: UUID, emailVerifiedAtUtc: verified })) },
        },
      ],
    })
      .overrideGuard(RateLimitGuard)
      .useValue(open)
      .overrideGuard(OrganizationRoleGuard)
      .useValue(open)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: false }));
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    business.mockClear();
  });

  const send = (c: Case) => {
    const req = request(app.getHttpServer())[c.method](c.url);
    if (c.attach) return req.field('attachmentKind', 'CLIENT_PHOTO').attach('file', Buffer.from('x'), 'a.jpg');
    return req.send(c.body ?? {});
  };

  it.each(CASES)('$name — unconfirmed → 403 EMAIL_NOT_VERIFIED, business layer untouched', async (c) => {
    verified = null;
    const res = await send(c);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(EMAIL_NOT_VERIFIED);
    expect(business).not.toHaveBeenCalled();
  });

  it.each(CASES)('$name — confirmed → no longer blocked by the email guard', async (c) => {
    verified = new Date();
    const res = await send(c);
    expect(res.body.code).not.toBe(EMAIL_NOT_VERIFIED);
    // 403 would only be a business refusal; here the guard let the call through.
    expect(res.status).not.toBe(403);
  });
});
