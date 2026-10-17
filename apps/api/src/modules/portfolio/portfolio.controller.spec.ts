import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Readable } from 'stream';
import request from 'supertest';
import { AdminGuard } from '../../common/guards/admin.guard';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { SystemRole } from '../users/enums/system-role.enum';
import { UsersRepository } from '../users/users.repository';
import { AdminPortfolioController } from './admin-portfolio.controller';
import { PORTFOLIO_CAPTION_MAX, PORTFOLIO_MAX_BYTES } from './constants';
import { PortfolioController, PortfolioImageController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

/**
 * Pins what only the framework wiring decides: the multipart size limit (413
 * BEFORE the service), the DTO normalisation of captions, the route order of
 * `me` vs `:id`, the headers of the image, and the admin guard.
 *
 * A stand-in global guard plays the JWT guard: it sets `request.user` from an
 * `x-test-user` header, so a test chooses who is calling.
 */
@Injectable()
class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const sub = req.headers['x-test-user'];
    if (sub) req.user = { sub, email: `${sub}@linkr.test`, type: 'access' };
    return true;
  }
}

const ITEM = '33333333-3333-4333-8333-333333333333';
const PROVIDER = '11111111-1111-4111-8111-111111111111';

describe('Portfolio controllers (wiring)', () => {
  let app: INestApplication;
  let service: Record<string, jest.Mock>;
  let users: { findById: jest.Mock };

  beforeEach(async () => {
    service = {
      listMine: jest.fn().mockResolvedValue({ items: [] }),
      upload: jest.fn().mockResolvedValue({ id: ITEM }),
      updateCaption: jest.fn().mockResolvedValue({ id: ITEM }),
      reorder: jest.fn().mockResolvedValue({ items: [] }),
      deleteMine: jest.fn().mockResolvedValue(undefined),
      listPublic: jest.fn().mockResolvedValue({ items: [] }),
      getPublicImage: jest.fn().mockResolvedValue({
        stream: Readable.from([Buffer.from('RIFFxxxxWEBP')]),
        contentType: 'image/webp',
        byteSize: 12,
      }),
      deleteAsAdmin: jest.fn().mockResolvedValue(undefined),
    };
    users = {
      findById: jest.fn().mockImplementation(async (id: string) => ({
        id,
        systemRole: id === 'admin' ? SystemRole.ADMIN : SystemRole.USER,
      })),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PortfolioController, PortfolioImageController, AdminPortfolioController],
      providers: [
        { provide: PortfolioService, useValue: service },
        { provide: UsersRepository, useValue: users },
        AdminGuard,
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

  describe('POST /service-providers/me/portfolio', () => {
    it('refuses a file over 5 MB with 413 in the multipart parser — the service is never reached', async () => {
      const res = await http()
        .post('/service-providers/me/portfolio')
        .set('x-test-user', 'pro')
        .attach('file', Buffer.alloc(PORTFOLIO_MAX_BYTES + 1), 'big.jpg');
      expect(res.status).toBe(413);
      expect(service.upload).not.toHaveBeenCalled();
    });

    it('passes a 5 MB file (the limit is inclusive) to the service', async () => {
      const res = await http()
        .post('/service-providers/me/portfolio')
        .set('x-test-user', 'pro')
        .attach('file', Buffer.alloc(PORTFOLIO_MAX_BYTES), 'ok.jpg');
      expect(res.status).toBe(201);
      expect(service.upload.mock.calls[0][1].buffer.length).toBe(PORTFOLIO_MAX_BYTES);
    });

    it('trims the caption before checking its length', async () => {
      const caption = `  ${'a'.repeat(PORTFOLIO_CAPTION_MAX)}  `;
      const res = await http()
        .post('/service-providers/me/portfolio')
        .set('x-test-user', 'pro')
        .field('caption', caption)
        .attach('file', Buffer.from('x'), 'a.jpg');
      expect(res.status).toBe(201);
      expect(service.upload.mock.calls[0][2]).toBe('a'.repeat(PORTFOLIO_CAPTION_MAX));
    });

    it('refuses a caption of 141 characters with 400', async () => {
      const res = await http()
        .post('/service-providers/me/portfolio')
        .set('x-test-user', 'pro')
        .field('caption', 'a'.repeat(PORTFOLIO_CAPTION_MAX + 1))
        .attach('file', Buffer.from('x'), 'a.jpg');
      expect(res.status).toBe(400);
      expect(service.upload).not.toHaveBeenCalled();
    });

    it('turns a blank caption into null', async () => {
      await http()
        .post('/service-providers/me/portfolio')
        .set('x-test-user', 'pro')
        .field('caption', '    ')
        .attach('file', Buffer.from('x'), 'a.jpg')
        .expect(201);
      expect(service.upload.mock.calls[0][2]).toBeNull();
    });

    it('refuses an unknown multipart field with 400 (forbidNonWhitelisted)', async () => {
      const res = await http()
        .post('/service-providers/me/portfolio')
        .set('x-test-user', 'pro')
        .field('position', '0')
        .attach('file', Buffer.from('x'), 'a.jpg');
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /service-providers/me/portfolio/:itemId', () => {
    it('PATCH {} is a 400, not a silent no-op', async () => {
      const res = await http()
        .patch(`/service-providers/me/portfolio/${ITEM}`)
        .set('x-test-user', 'pro')
        .send({});
      expect(res.status).toBe(400);
      expect(service.updateCaption).not.toHaveBeenCalled();
    });

    it('null and an empty string both clear the caption', async () => {
      for (const caption of [null, '', '   ']) {
        await http()
          .patch(`/service-providers/me/portfolio/${ITEM}`)
          .set('x-test-user', 'pro')
          .send({ caption })
          .expect(200);
      }
      expect(service.updateCaption.mock.calls.map((c) => c[2])).toEqual([null, null, null]);
    });

    it('141 characters after trimming → 400', async () => {
      const res = await http()
        .patch(`/service-providers/me/portfolio/${ITEM}`)
        .set('x-test-user', 'pro')
        .send({ caption: 'b'.repeat(PORTFOLIO_CAPTION_MAX + 1) });
      expect(res.status).toBe(400);
    });

    it('a malformed item id → 400', async () => {
      await http()
        .patch('/service-providers/me/portfolio/not-a-uuid')
        .set('x-test-user', 'pro')
        .send({ caption: 'x' })
        .expect(400);
    });
  });

  describe('PUT /service-providers/me/portfolio/order', () => {
    it('a duplicate id reaches the service (its answer is 422, not a 400 from validation)', async () => {
      await http()
        .put('/service-providers/me/portfolio/order')
        .set('x-test-user', 'pro')
        .send({ ids: [ITEM, ITEM] })
        .expect(200);
      expect(service.reorder).toHaveBeenCalledWith('pro', [ITEM, ITEM]);
    });

    it('not an array of uuids → 400', async () => {
      await http()
        .put('/service-providers/me/portfolio/order')
        .set('x-test-user', 'pro')
        .send({ ids: ['nope'] })
        .expect(400);
    });
  });

  describe('route order', () => {
    it('GET /service-providers/me/portfolio is the owner list, not a public :id', async () => {
      await http().get('/service-providers/me/portfolio').set('x-test-user', 'pro').expect(200);
      expect(service.listMine).toHaveBeenCalledWith('pro');
      expect(service.listPublic).not.toHaveBeenCalled();
    });

    it('GET /service-providers/:id/portfolio is the public list', async () => {
      await http().get(`/service-providers/${PROVIDER}/portfolio`).expect(200);
      expect(service.listPublic).toHaveBeenCalledWith(PROVIDER);
    });

    it('the two public routes, and only them, are @Public()', () => {
      const pub = (proto: object, name: string) =>
        Reflect.getMetadata(IS_PUBLIC_KEY, (proto as Record<string, unknown>)[name] as object);
      expect(pub(PortfolioController.prototype, 'listPublic')).toBe(true);
      expect(pub(PortfolioImageController.prototype, 'image')).toBe(true);
      for (const name of ['listMine', 'upload', 'reorder', 'updateCaption', 'deleteMine']) {
        expect(pub(PortfolioController.prototype, name)).toBeUndefined();
      }
    });
  });

  describe('GET /portfolio/:itemId/image', () => {
    it('streams with Content-Type, Content-Length, nosniff and a public cache', async () => {
      const res = await http().get(`/portfolio/${ITEM}/image`).buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      expect(res.headers['content-length']).toBe('12');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('public, max-age=3600');
      expect(Buffer.from(res.body).toString()).toBe('RIFFxxxxWEBP');
      expect(res.headers.location).toBeUndefined();
    });

    it('a 404 does NOT carry the public cache header', async () => {
      service.getPublicImage.mockRejectedValue(new NotFoundException('Portfolio photo not found'));
      const res = await http().get(`/portfolio/${ITEM}/image`);
      expect(res.status).toBe(404);
      expect(res.headers['cache-control'] ?? '').not.toContain('public');
    });
  });

  describe('DELETE /admin/portfolio/:itemId', () => {
    it('a non-admin → 403, the service is never reached', async () => {
      await http().delete(`/admin/portfolio/${ITEM}`).set('x-test-user', 'pro').expect(403);
      expect(service.deleteAsAdmin).not.toHaveBeenCalled();
    });

    it('an admin → 204, and the admin id is passed on (for the log)', async () => {
      await http().delete(`/admin/portfolio/${ITEM}`).set('x-test-user', 'admin').expect(204);
      expect(service.deleteAsAdmin).toHaveBeenCalledWith('admin', ITEM);
    });
  });
});
