import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { CREATE_REQUEST_RATE_LIMIT, DESCRIPTION_MAX } from './constants';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { ServiceRequestsController } from './service-requests.controller';
import { ServiceRequestsService } from './service-requests.service';

/**
 * `POST /service-requests` — budget de création et longueur de la description.
 * Le contrôleur, la vraie garde et le vrai `ValidationPipe` (options de
 * `main.ts`) sont montés ; seul le service est une doublure.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const metadata: ArgumentMetadata = { type: 'body', metatype: CreateServiceRequestDto, data: '' };

function tenderBody(description: string): Record<string, unknown> {
  return {
    requestType: 'PROJECT_TENDER',
    serviceCategoryId: '11111111-1111-4111-8111-111111111111',
    title: 'Peinture',
    description,
    serviceAddress: '1 rue Test',
    serviceLocation: { type: 'Point', coordinates: [-73.7, 45.6] },
    quotesDeadlineUtc: '2030-01-01T00:00:00.000Z',
  };
}

const rejects = async (description: unknown) =>
  pipe.transform({ ...tenderBody('x'), description }, metadata).then(
    () => false,
    () => true,
  );

describe('CreateServiceRequestDto — description length', () => {
  it('accepts a description of exactly DESCRIPTION_MAX characters', async () => {
    await expect(
      pipe.transform(tenderBody('a'.repeat(DESCRIPTION_MAX)), metadata),
    ).resolves.toBeDefined();
  });

  it('refuses one character more', async () => {
    expect(await rejects('a'.repeat(DESCRIPTION_MAX + 1))).toBe(true);
  });

  it('refuses an empty description and a non-string', async () => {
    expect(await rejects('')).toBe(true);
    expect(await rejects(42)).toBe(true);
  });
});

describe('ServiceRequestsController — create rate limiting', () => {
  let app: NestExpressApplication;
  let create: jest.Mock;
  let currentUser: string;

  beforeEach(async () => {
    create = jest.fn().mockResolvedValue({ id: 'r1' });
    currentUser = 'user-a';
    const moduleRef = await Test.createTestingModule({
      controllers: [ServiceRequestsController],
      providers: [RateLimitGuard, { provide: ServiceRequestsService, useValue: { create } }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', 'loopback');
    // Stand-in for the global JwtAuthGuard, which runs before route guards.
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { sub: currentUser, email: 'x@linkr.test', type: 'access' };
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (ip = '203.0.113.10') =>
    request(app.getHttpServer())
      .post('/service-requests')
      .set('X-Forwarded-For', ip)
      .send(tenderBody('ok'));

  it('lets normal use through: a few creations are untouched', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await post()).status).toBe(201);
    }
  });

  it('answers 429 with a whole-second Retry-After once the budget is spent', async () => {
    const { limit, windowSeconds } = CREATE_REQUEST_RATE_LIMIT;
    for (let i = 0; i < limit; i += 1) {
      expect((await post()).status).toBe(201);
    }
    const blocked = await post();
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(windowSeconds);
    expect(create).toHaveBeenCalledTimes(limit); // the refusal wrote nothing
  });

  it('meters per signed-in user, not per address', async () => {
    const { limit } = CREATE_REQUEST_RATE_LIMIT;
    for (let i = 0; i < limit; i += 1) await post('203.0.113.10');
    expect((await post('203.0.113.10')).status).toBe(429);

    // Same address, another account: its own budget.
    currentUser = 'user-b';
    expect((await post('203.0.113.10')).status).toBe(201);

    // Same account from another address: still spent.
    currentUser = 'user-a';
    expect((await post('198.51.100.20')).status).toBe(429);
  });
});
