import { NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { IStorageService } from '../../common/storage/storage.interface';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { PortfolioItemDto } from './dto/portfolio-item.dto';
import {
  PORTFOLIO_LIMIT_REACHED,
  PortfolioFileMissingException,
  PortfolioLimitReachedException,
  PortfolioOrderMismatchException,
  PortfolioUnsupportedImageException,
} from './exceptions/portfolio-exceptions';
import { PortfolioImageProcessor } from './portfolio-image.processor';
import { PortfolioService } from './portfolio.service';
import {
  PortfolioItemRecord,
  PortfolioItemRepository,
} from './repositories/portfolio-item.repository';

/**
 * Service wiring, with the repository, the provider reads, the processor and
 * the storage mocked. What only a real database can prove — the lock that keeps
 * two concurrent uploads from making 13 photos, and the exact-set check of the
 * reorder — is proven by `src/database/probes/portfolio.probe.ts`.
 */
describe('PortfolioService', () => {
  const USER = 'user-1';
  const PROVIDER = '11111111-1111-4111-8111-111111111111';
  const OTHER_PROVIDER = '22222222-2222-4222-8222-222222222222';
  const ITEM = '33333333-3333-4333-8333-333333333333';

  const record = (over: Partial<PortfolioItemRecord> = {}): PortfolioItemRecord => ({
    id: ITEM,
    serviceProviderId: PROVIDER,
    storageKey: `portfolio/${PROVIDER}/secret-key.webp`,
    caption: 'Salle de bain refaite',
    position: 0,
    contentType: 'image/webp',
    width: 1200,
    height: 1600,
    byteSize: 34567,
    createdAtUtc: new Date('2026-10-16T12:00:00Z'),
    updatedAtUtc: new Date('2026-10-16T12:00:00Z'),
    ...over,
  });

  let items: jest.Mocked<
    Pick<
      PortfolioItemRepository,
      | 'findLiveByProvider'
      | 'findLiveById'
      | 'countLive'
      | 'insertUnderCap'
      | 'updateCaption'
      | 'reorder'
      | 'softDelete'
    >
  >;
  let providers: { findByUserId: jest.Mock; findById: jest.Mock };
  let processor: { process: jest.Mock };
  let storage: jest.Mocked<IStorageService>;
  let service: PortfolioService;

  beforeEach(() => {
    items = {
      findLiveByProvider: jest.fn().mockResolvedValue([record()]),
      findLiveById: jest.fn().mockResolvedValue(record()),
      countLive: jest.fn().mockResolvedValue(0),
      insertUnderCap: jest.fn().mockResolvedValue({ inserted: true, item: record() }),
      updateCaption: jest.fn().mockResolvedValue(record()),
      reorder: jest.fn().mockResolvedValue(true),
      softDelete: jest.fn().mockResolvedValue(record()),
    };
    providers = {
      findByUserId: jest.fn().mockResolvedValue({ id: PROVIDER }),
      findById: jest.fn().mockResolvedValue({ id: PROVIDER }),
    };
    processor = {
      process: jest.fn().mockResolvedValue({
        buffer: Buffer.from('webp-bytes'),
        contentType: 'image/webp',
        width: 1200,
        height: 1600,
        byteSize: 10,
      }),
    };
    storage = {
      upload: jest.fn().mockImplementation(async ({ key }) => ({ key })),
      getStream: jest.fn().mockResolvedValue({ stream: Readable.from(['x']) }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new PortfolioService(
      items as unknown as PortfolioItemRepository,
      providers as unknown as ServiceProviderRepository,
      processor as unknown as PortfolioImageProcessor,
      storage,
    );
  });

  const file = { buffer: Buffer.from('jpeg'), size: 4 };

  // ── Upload ──────────────────────────────────────────────────────────────

  describe('upload', () => {
    it('processes, then stores under portfolio/{providerId}/{uuid}.webp, then inserts — in that order', async () => {
      const dto = await service.upload(USER, file, 'Ma cuisine');

      const order = [
        processor.process.mock.invocationCallOrder[0],
        storage.upload.mock.invocationCallOrder[0],
        items.insertUnderCap.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));

      const key = storage.upload.mock.calls[0][0].key;
      expect(key).toMatch(
        new RegExp(`^portfolio/${PROVIDER}/[0-9a-f-]{36}\\.webp$`),
      );
      expect(storage.upload.mock.calls[0][0].mimeType).toBe('image/webp');
      expect(items.insertUnderCap).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceProviderId: PROVIDER,
          storageKey: key,
          caption: 'Ma cuisine',
          contentType: 'image/webp',
          width: 1200,
          height: 1600,
          byteSize: 10,
        }),
      );
      expect(dto).toBeInstanceOf(PortfolioItemDto);
    });

    it('stores the OUTPUT of the processor, never the uploaded bytes', async () => {
      await service.upload(USER, file, undefined);
      expect(storage.upload.mock.calls[0][0].buffer.toString()).toBe('webp-bytes');
    });

    it('refuses a 13th photo early with 409 and the explicit code — nothing processed, nothing stored', async () => {
      items.countLive.mockResolvedValue(12);
      const err = await service.upload(USER, file, null).catch((e) => e);
      expect(err).toBeInstanceOf(PortfolioLimitReachedException);
      expect(err.getStatus()).toBe(409);
      expect(err.getResponse()).toMatchObject({ code: PORTFOLIO_LIMIT_REACHED });
      expect(processor.process).not.toHaveBeenCalled();
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('accepts the 12th photo (11 live)', async () => {
      items.countLive.mockResolvedValue(11);
      await expect(service.upload(USER, file, null)).resolves.toBeInstanceOf(
        PortfolioItemDto,
      );
    });

    it('when the LOCKED count refuses (concurrent upload), deletes the stored file and answers 409', async () => {
      items.countLive.mockResolvedValue(11);
      items.insertUnderCap.mockResolvedValue({ inserted: false, reason: 'LIMIT_REACHED' });
      await expect(service.upload(USER, file, null)).rejects.toBeInstanceOf(
        PortfolioLimitReachedException,
      );
      const key = storage.upload.mock.calls[0][0].key;
      expect(storage.delete).toHaveBeenCalledWith(key);
    });

    it('when the INSERT throws, deletes the stored file (best effort) and rethrows', async () => {
      const boom = new Error('insert failed');
      items.insertUnderCap.mockRejectedValue(boom);
      storage.delete.mockRejectedValue(new Error('storage down'));
      await expect(service.upload(USER, file, null)).rejects.toBe(boom);
      expect(storage.delete).toHaveBeenCalledTimes(1);
    });

    it('a processor refusal stores nothing', async () => {
      processor.process.mockRejectedValue(new PortfolioUnsupportedImageException());
      await expect(service.upload(USER, file, null)).rejects.toBeInstanceOf(
        PortfolioUnsupportedImageException,
      );
      expect(storage.upload).not.toHaveBeenCalled();
      expect(items.insertUnderCap).not.toHaveBeenCalled();
    });

    it('no file → 400', async () => {
      await expect(service.upload(USER, undefined, null)).rejects.toBeInstanceOf(
        PortfolioFileMissingException,
      );
    });

    it('a user without a provider → 404', async () => {
      providers.findByUserId.mockResolvedValue(null);
      await expect(service.upload(USER, file, null)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(processor.process).not.toHaveBeenCalled();
    });
  });

  // ── Owner reads / writes ────────────────────────────────────────────────

  describe('owner routes', () => {
    it('touching another provider’s photo is a 404, never a 403 (caption)', async () => {
      items.updateCaption.mockResolvedValue(null);
      await expect(service.updateCaption(USER, ITEM, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // The ownership is part of the WHERE: the caller's own provider id.
      expect(items.updateCaption).toHaveBeenCalledWith(ITEM, PROVIDER, 'x');
    });

    it('touching another provider’s photo is a 404, never a 403 (delete) — and no file is deleted', async () => {
      items.softDelete.mockResolvedValue(null);
      await expect(service.deleteMine(USER, ITEM)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(items.softDelete).toHaveBeenCalledWith(ITEM, PROVIDER);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('delete soft-deletes the row, THEN deletes the file', async () => {
      await service.deleteMine(USER, ITEM);
      expect(storage.delete).toHaveBeenCalledWith(`portfolio/${PROVIDER}/secret-key.webp`);
      expect(items.softDelete.mock.invocationCallOrder[0]).toBeLessThan(
        storage.delete.mock.invocationCallOrder[0],
      );
    });

    it('a storage failure on delete is logged, not surfaced (the photo is gone for the user)', async () => {
      storage.delete.mockRejectedValue(new Error('storage down'));
      await expect(service.deleteMine(USER, ITEM)).resolves.toBeUndefined();
    });

    it('reorder: a set mismatch is a 422', async () => {
      items.reorder.mockResolvedValue(false);
      await expect(service.reorder(USER, [ITEM])).rejects.toBeInstanceOf(
        PortfolioOrderMismatchException,
      );
      expect(items.reorder).toHaveBeenCalledWith(PROVIDER, [ITEM]);
    });

    it('reorder: success returns the list in its new order', async () => {
      const list = await service.reorder(USER, [ITEM]);
      expect(list.items.map((i) => i.id)).toEqual([ITEM]);
    });

    it('admin delete: any provider, file deleted too', async () => {
      items.softDelete.mockResolvedValue(record({ serviceProviderId: OTHER_PROVIDER }));
      await service.deleteAsAdmin('admin-1', ITEM);
      expect(items.softDelete).toHaveBeenCalledWith(ITEM);
      expect(storage.delete).toHaveBeenCalledTimes(1);
    });
  });

  // ── Public ──────────────────────────────────────────────────────────────

  describe('public routes', () => {
    it('a provider that is not visible → 404', async () => {
      providers.findById.mockResolvedValue(null);
      await expect(service.listPublic(PROVIDER)).rejects.toBeInstanceOf(NotFoundException);
      expect(items.findLiveByProvider).not.toHaveBeenCalled();
    });

    it('the JSON never carries a storage key nor an absolute URL', async () => {
      const list = await service.listPublic(PROVIDER);
      const json = JSON.stringify(list);
      expect(json).not.toMatch(/storage|secret-key|storageKey/i);
      expect(json).not.toMatch(/https?:\/\//);
      expect(json).not.toMatch(/localhost|:5000/);
      expect(list.items[0]).toEqual({
        id: ITEM,
        caption: 'Salle de bain refaite',
        width: 1200,
        height: 1600,
        imageUrl: `/media/portfolio/${ITEM}`,
      });
    });

    it('the owner list carries no storage key nor absolute URL either', async () => {
      const json = JSON.stringify(await service.listMine(USER));
      expect(json).not.toMatch(/secret-key|storageKey|https?:\/\//);
    });

    it('image: a deleted photo → 404', async () => {
      items.findLiveById.mockResolvedValue(null);
      await expect(service.getPublicImage(ITEM)).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    it('image: a provider no longer visible → 404', async () => {
      providers.findById.mockResolvedValue(null);
      await expect(service.getPublicImage(ITEM)).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    it('image: a file missing from storage → 404, the storage error never surfaces', async () => {
      storage.getStream.mockRejectedValue(new Error('NoSuchKey s3://bucket/portfolio/...'));
      const err = await service.getPublicImage(ITEM).catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(JSON.stringify(err.getResponse())).not.toMatch(/s3|bucket|portfolio\//);
    });

    it('image: streams with the stored type and the OUTPUT size', async () => {
      const img = await service.getPublicImage(ITEM);
      expect(img.contentType).toBe('image/webp');
      expect(img.byteSize).toBe(34567);
    });
  });
});
