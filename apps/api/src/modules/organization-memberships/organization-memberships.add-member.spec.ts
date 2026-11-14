import 'reflect-metadata';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EMAIL_NOT_VERIFIED } from '../auth/email-verification.exceptions';
import { UsersRepository } from '../users/users.repository';
import { OrganizationMembershipsController } from './organization-memberships.controller';
import { OrganizationMembershipsService } from './organization-memberships.service';
import { OrganizationMembershipsRepository } from './organization-memberships.repository';
import { OrganizationRoleGuard } from './guards/organization-role.guard';

/**
 * Option A (neutral answer): POST /organizations/:orgId/members answers
 * 202 + empty body in the three cases (unknown email, already an active member,
 * added). Real controller + real service; repositories are doubles.
 */
const ORG = '6b0c3a0e-1111-4c3e-9d77-0000000000aa';
const CALLER = '6b0c3a0e-1111-4c3e-9d77-000000000001';
const TARGET = '6b0c3a0e-1111-4c3e-9d77-000000000002';

const fakeJwt: CanActivate = {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().user = { sub: CALLER, email: 'owner@linkr.test', type: 'access' };
    return true;
  },
};

describe('POST /organizations/:orgId/members — neutral response', () => {
  let app: INestApplication;
  let roleAllowed = true;
  let callerVerified: Date | null = new Date();
  const findByEmail = jest.fn();
  const findById = jest.fn(async () => ({ id: CALLER, emailVerifiedAtUtc: callerVerified }));
  const findActive = jest.fn();
  const create = jest.fn();

  const roleGuard: CanActivate = {
    canActivate: () => {
      if (!roleAllowed) throw new ForbiddenException('role');
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OrganizationMembershipsController],
      providers: [
        { provide: APP_GUARD, useValue: fakeJwt },
        OrganizationMembershipsService,
        { provide: UsersRepository, useValue: { findByEmail, findById } },
        {
          provide: OrganizationMembershipsRepository,
          useValue: { findActiveByOrgAndUser: findActive, create },
        },
      ],
    })
      .overrideGuard(OrganizationRoleGuard)
      .useValue(roleGuard)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    roleAllowed = true;
    callerVerified = new Date();
  });

  const post = (email = 'target@linkr.test') =>
    request(app.getHttpServer()).post(`/organizations/${ORG}/members`).send({ email });

  it('answers identically (202, empty body, same headers) in the three cases; only "added" writes', async () => {
    // 1. unknown email
    findByEmail.mockResolvedValueOnce(null);
    const unknown = await post();
    // 2. already an active member
    findByEmail.mockResolvedValueOnce({ id: TARGET });
    findActive.mockResolvedValueOnce({ id: 'm1' });
    const already = await post();
    expect(create).not.toHaveBeenCalled();
    // 3. added
    findByEmail.mockResolvedValueOnce({ id: TARGET });
    findActive.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: 'm2' });
    const added = await post();

    for (const res of [unknown, already, added]) {
      expect(res.status).toBe(202);
      expect(res.text).toBe('');
      expect(res.body).toEqual({});
    }
    const pick = (r: request.Response) => ({
      ct: r.headers['content-type'],
      cl: r.headers['content-length'],
    });
    expect(pick(already)).toEqual(pick(unknown));
    expect(pick(added)).toEqual(pick(unknown));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(ORG, TARGET, 'WORKER');
  });

  it('a concurrent add (unique violation) is also neutral', async () => {
    findByEmail.mockResolvedValueOnce({ id: TARGET });
    findActive.mockResolvedValueOnce(null);
    create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const res = await post();
    expect(res.status).toBe(202);
    expect(res.text).toBe('');
  });

  it('unconfirmed OWNER → 403 EMAIL_NOT_VERIFIED, users repository never queried by email', async () => {
    callerVerified = null;
    const res = await post();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(EMAIL_NOT_VERIFIED);
    expect(findByEmail).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('non-OWNER → role refusal (unchanged)', async () => {
    roleAllowed = false;
    const res = await post();
    expect(res.status).toBe(403);
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('malformed email → 400 (independent of account existence)', async () => {
    const res = await post('not-an-email');
    expect(res.status).toBe(400);
    expect(findByEmail).not.toHaveBeenCalled();
  });
});
