import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  Logger,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { OrganizationMembershipsRepository } from '../organization-memberships/organization-memberships.repository';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { ReviewsRepository } from '../reviews/repositories/reviews.repository';
import { SystemRole } from '../users/enums/system-role.enum';
import { UsersRepository } from '../users/users.repository';
import { PublicServiceProviderDto } from './dto/public-service-provider.dto';
import { ProviderType } from './enums/provider-type.enum';
import { ProfessionalServiceZoneRepository } from './repositories/professional-service-zone.repository';
import {
  ServiceProviderRecord,
  ServiceProviderRepository,
} from './repositories/service-provider.repository';
import { ServiceProvidersController } from './service-providers.controller';
import { ServiceProvidersService } from './service-providers.service';
import { ServiceZonesController } from './service-zones.controller';

/**
 * No provider location leaves the API through a route another user can call.
 *
 * Boots the REAL controllers and the REAL service; only the repositories are
 * stand-ins. A fake global guard plays `JwtAuthGuard`: it honours `@Public()`,
 * answers 401 when there is no `x-test-user` header, and otherwise sets
 * `request.user` — so each test chooses who is calling, or that nobody is.
 */
@Injectable()
class FakeJwtGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest();
    const sub = req.headers['x-test-user'];
    if (sub) req.user = { sub, email: `${sub}@linkr.test`, type: 'access' };
    if (isPublic) return true;
    if (!sub) throw new UnauthorizedException();
    return true;
  }
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const PROVIDER = '44444444-4444-4444-8444-444444444444';
const ORG_PROVIDER = '55555555-5555-4555-8555-555555555555';
const ORG = '66666666-6666-4666-8666-666666666666';
const UNKNOWN = '77777777-7777-4777-8777-777777777777';

/** The ONLY keys the public profile may carry. A new field must be added here on purpose. */
const PUBLIC_PROFILE_KEYS = ['bio', 'businessName', 'headline', 'id'];

const individual: ServiceProviderRecord = {
  id: PROVIDER,
  providerType: ProviderType.INDIVIDUAL,
  userId: OWNER,
  organizationId: null,
  businessName: 'Coiffure Dana',
  headline: 'Coupes et colorations',
  bio: 'Vingt ans de métier.',
  serviceBaseLocation: { type: 'Point', coordinates: [-73.5673912, 45.5017156] },
  serviceRadiusKm: 25,
  isActive: true,
  activatedAtUtc: new Date('2026-09-01T12:00:00Z'),
  createdAtUtc: new Date('2026-09-01T12:00:00Z'),
  updatedAtUtc: new Date('2026-09-02T12:00:00Z'),
};

const organization: ServiceProviderRecord = {
  ...individual,
  id: ORG_PROVIDER,
  providerType: ProviderType.ORGANIZATION,
  userId: null,
  organizationId: ORG,
  businessName: null,
};

const zone = {
  id: '88888888-8888-4888-8888-888888888888',
  serviceProviderId: PROVIDER,
  zonePolygon: {
    type: 'Polygon',
    coordinates: [
      [
        [-73.6, 45.5],
        [-73.5, 45.5],
        [-73.5, 45.6],
        [-73.6, 45.5],
      ],
    ],
  },
  zoneLabel: 'Plateau',
  createdAtUtc: new Date('2026-09-01T12:00:00Z'),
  updatedAtUtc: new Date('2026-09-01T12:00:00Z'),
};

describe('Provider location exposure (wiring)', () => {
  let app: INestApplication;
  let zoneRepo: { findByProviderId: jest.Mock };

  beforeEach(async () => {
    const records = new Map([
      [PROVIDER, individual],
      [ORG_PROVIDER, organization],
    ]);
    const providerRepo = {
      findById: jest.fn(async (id: string) => records.get(id) ?? null),
      findByUserId: jest.fn(async (userId: string) =>
        userId === OWNER ? individual : null,
      ),
    };
    zoneRepo = { findByProviderId: jest.fn().mockResolvedValue([zone]) };
    const usersRepository = {
      findById: jest.fn(async (id: string) => ({
        id,
        systemRole: id === ADMIN ? SystemRole.ADMIN : SystemRole.USER,
      })),
    };
    const organizationsRepository = {
      findById: jest.fn(async (id: string) =>
        id === ORG ? { id: ORG, displayName: 'Plomberie ABC' } : null,
      ),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ServiceProvidersController, ServiceZonesController],
      providers: [
        ServiceProvidersService,
        { provide: ServiceProviderRepository, useValue: providerRepo },
        { provide: ProfessionalServiceZoneRepository, useValue: zoneRepo },
        { provide: UsersRepository, useValue: usersRepository },
        { provide: OrganizationsRepository, useValue: organizationsRepository },
        // The provider under test is INDIVIDUAL: no membership is ever read.
        { provide: OrganizationMembershipsRepository, useValue: {} },
        { provide: ReviewsRepository, useValue: {} },
        { provide: APP_GUARD, useClass: FakeJwtGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirrors `main.ts`.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('GET /service-providers/:id — public profile', () => {
    it('answers without a token, with EXACTLY the allow-listed keys', async () => {
      const res = await http().get(`/service-providers/${PROVIDER}`);
      expect(res.status).toBe(200);
      // The whole key set, not a few absences: a field added later fails here.
      expect(Object.keys(res.body).sort()).toEqual(PUBLIC_PROFILE_KEYS);
      expect(res.body).toEqual({
        id: PROVIDER,
        businessName: 'Coiffure Dana',
        headline: 'Coupes et colorations',
        bio: 'Vingt ans de métier.',
      });
    });

    it('carries no coordinate anywhere in the body', async () => {
      const res = await http().get(`/service-providers/${PROVIDER}`);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('73.567');
      expect(raw).not.toContain('45.501');
      expect(raw).not.toContain(OWNER);
    });

    it('is the same allow-list for an authenticated stranger', async () => {
      const res = await http()
        .get(`/service-providers/${PROVIDER}`)
        .set('x-test-user', STRANGER);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(PUBLIC_PROFILE_KEYS);
    });

    it('resolves an organization name without exposing the organization id', async () => {
      const res = await http().get(`/service-providers/${ORG_PROVIDER}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(PUBLIC_PROFILE_KEYS);
      expect(res.body.businessName).toBe('Plomberie ABC');
      expect(JSON.stringify(res.body)).not.toContain(ORG);
    });

    it('404s an unknown provider', async () => {
      await http().get(`/service-providers/${UNKNOWN}`).expect(404);
    });
  });

  describe('GET /service-providers/me — owner view', () => {
    it('keeps the base location and the account id for the owner', async () => {
      const res = await http().get('/service-providers/me').set('x-test-user', OWNER);
      expect(res.status).toBe(200);
      expect(res.body.serviceBaseLocation).toEqual(individual.serviceBaseLocation);
      expect(res.body.userId).toBe(OWNER);
    });
  });

  describe('GET /service-providers/:id/zones — owner or ADMIN only', () => {
    const path = `/service-providers/${PROVIDER}/zones`;

    it('401 without a token', async () => {
      await http().get(path).expect(401);
      expect(zoneRepo.findByProviderId).not.toHaveBeenCalled();
    });

    it('403 for another user — and the zones are never read', async () => {
      await http().get(path).set('x-test-user', STRANGER).expect(403);
      expect(zoneRepo.findByProviderId).not.toHaveBeenCalled();
    });

    it('200 for the owner', async () => {
      const res = await http().get(path).set('x-test-user', OWNER);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].zoneLabel).toBe('Plateau');
    });

    it('200 for an ADMIN', async () => {
      const res = await http().get(path).set('x-test-user', ADMIN);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('404 for an unknown provider, ADMIN or not', async () => {
      const unknown = `/service-providers/${UNKNOWN}/zones`;
      await http().get(unknown).set('x-test-user', ADMIN).expect(404);
      await http().get(unknown).set('x-test-user', STRANGER).expect(404);
    });
  });
});

describe('PublicServiceProviderDto.from', () => {
  it('copies field by field: a column added to the record does not leak', () => {
    // Stands for the next column someone adds to the provider record.
    const future = { ...individual, phone: '+15145551234' } as ServiceProviderRecord;
    const dto = PublicServiceProviderDto.from(future, 'Coiffure Dana');
    expect(Object.keys(dto).sort()).toEqual(PUBLIC_PROFILE_KEYS);
  });
});

describe('ServiceProvidersService.discover — log', () => {
  it('writes the searched point to the log at 2 decimals, never the exact point', async () => {
    const service = new ServiceProvidersService(
      {
        findEligibleForDiscovery: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      } as unknown as ServiceProviderRepository,
      {} as unknown as ProfessionalServiceZoneRepository,
      {} as unknown as UsersRepository,
      {} as unknown as OrganizationsRepository,
      {} as unknown as OrganizationMembershipsRepository,
      { findAggregatesForProviders: jest.fn().mockResolvedValue(new Map()) } as unknown as ReviewsRepository,
    );
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await service.discover({
        lat: 45.5017156,
        lng: -73.5673912,
        categoryId: '99999999-9999-4999-8999-999999999999',
        page: 1,
        limit: 20,
      });
      const lines = log.mock.calls.map((call) => String(call[0]));
      const line = lines.find((l) => l.startsWith('Discovery for category'));
      expect(line).toContain('(45.50, -73.57)');
      expect(lines.join('\n')).not.toContain('45.5017');
      expect(lines.join('\n')).not.toContain('73.5673');
    } finally {
      log.mockRestore();
    }
  });
});
