import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  IStorageService,
  STORAGE_SERVICE,
} from '../../common/storage/storage.interface';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { PORTFOLIO_MAX_ITEMS } from './constants';
import { PortfolioItemDto, PortfolioItemListDto } from './dto/portfolio-item.dto';
import {
  PublicPortfolioItemDto,
  PublicPortfolioListDto,
} from './dto/public-portfolio-item.dto';
import {
  PortfolioFileMissingException,
  PortfolioLimitReachedException,
  PortfolioOrderMismatchException,
} from './exceptions/portfolio-exceptions';
import { PortfolioImageProcessor } from './portfolio-image.processor';
import { PortfolioItemRepository } from './repositories/portfolio-item.repository';

/** The multer file, as far as this module reads it (memory storage → `buffer`). */
export interface UploadedPortfolioFile {
  buffer: Buffer;
  size: number;
}

/** What the public image route streams. Never the storage key. */
export interface PortfolioImageStream {
  stream: Readable;
  contentType: string;
  byteSize: number;
}

const ITEM_NOT_FOUND = 'Portfolio photo not found';
const PROVIDER_NOT_FOUND = 'Service provider not found';

/**
 * Portfolio photos of a provider (P1).
 *
 * ⚠️ « NOT YOURS » IS A 404, NEVER A 403. A provider touching another
 * provider's photo gets exactly the answer a missing photo gets, so the routes
 * cannot be used to learn that a given id exists (precedent: DELETE /reviews/:id).
 *
 * ⚠️ DELETING A PHOTO DELETES THE FILE (Loi 25). The row is soft-deleted like
 * everything else, but the photo itself must stop existing. The file deletion
 * runs AFTER the row is marked deleted, so a storage failure leaves an
 * unreachable file (logged loudly, to be cleaned by hand), never a live row
 * pointing at nothing. The user is not told about that failure: from their
 * side the photo is gone, and nothing they could do would help.
 *
 * ⚠️ PUBLIC VISIBILITY = THE PROFILE'S VISIBILITY, VERBATIM. A provider's
 * photos are public exactly when `GET /service-providers/:id` answers — the
 * provider exists and is not soft-deleted (`ServiceProviderRepository.findById`).
 * A PAUSED provider keeps a public profile, and therefore its photos. Hiding
 * them would be a product decision that also concerns the profile itself.
 */
@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly items: PortfolioItemRepository,
    private readonly providers: ServiceProviderRepository,
    private readonly processor: PortfolioImageProcessor,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  // ── Owner (`me`) ──────────────────────────────────────────────────────────

  async listMine(userId: string): Promise<PortfolioItemListDto> {
    const providerId = await this.resolveOwnProviderId(userId);
    const items = await this.items.findLiveByProvider(providerId);
    return { items: items.map((i) => PortfolioItemDto.from(i)) };
  }

  /**
   * Order of operations: early cap check → image processing → storage write →
   * capped INSERT under the provider lock. If anything fails AFTER the file is
   * written (the cap filled up meanwhile, the INSERT itself), the file is
   * deleted, best effort, and logged — a stored file without a row would be a
   * photo nobody can see or delete.
   */
  async upload(
    userId: string,
    file: UploadedPortfolioFile | undefined,
    caption: string | null | undefined,
  ): Promise<PortfolioItemDto> {
    if (!file || !file.buffer) throw new PortfolioFileMissingException();
    const providerId = await this.resolveOwnProviderId(userId);

    // Cheap, UNLOCKED refusal: spares the processing and the storage write of a
    // 13th photo in the common case. Not the guarantee — that is the locked
    // count inside `insertUnderCap`.
    if ((await this.items.countLive(providerId)) >= PORTFOLIO_MAX_ITEMS) {
      throw new PortfolioLimitReachedException();
    }

    const image = await this.processor.process(file.buffer);

    const storageKey = `portfolio/${providerId}/${randomUUID()}.webp`;
    await this.storage.upload({
      buffer: image.buffer,
      key: storageKey,
      mimeType: image.contentType,
    });

    let result;
    try {
      result = await this.items.insertUnderCap({
        serviceProviderId: providerId,
        storageKey,
        caption: caption ?? null,
        contentType: image.contentType,
        width: image.width,
        height: image.height,
        byteSize: image.byteSize,
      });
    } catch (err) {
      await this.deleteFileBestEffort(storageKey, 'insert failed');
      throw err;
    }

    if (!result.inserted) {
      await this.deleteFileBestEffort(storageKey, `insert refused (${result.reason})`);
      if (result.reason === 'LIMIT_REACHED') throw new PortfolioLimitReachedException();
      throw new NotFoundException(PROVIDER_NOT_FOUND);
    }

    this.logger.log(
      `Portfolio photo ${result.item.id} added for provider ${providerId} ` +
        `(${result.item.width}x${result.item.height}, ${result.item.byteSize} B)`,
    );
    return PortfolioItemDto.from(result.item);
  }

  async updateCaption(
    userId: string,
    itemId: string,
    caption: string | null,
  ): Promise<PortfolioItemDto> {
    const providerId = await this.resolveOwnProviderId(userId);
    const updated = await this.items.updateCaption(itemId, providerId, caption);
    if (!updated) throw new NotFoundException(ITEM_NOT_FOUND);
    return PortfolioItemDto.from(updated);
  }

  async reorder(userId: string, ids: string[]): Promise<PortfolioItemListDto> {
    const providerId = await this.resolveOwnProviderId(userId);
    const ok = await this.items.reorder(providerId, ids);
    if (!ok) throw new PortfolioOrderMismatchException();
    return this.listMine(userId);
  }

  async deleteMine(userId: string, itemId: string): Promise<void> {
    const providerId = await this.resolveOwnProviderId(userId);
    const deleted = await this.items.softDelete(itemId, providerId);
    if (!deleted) throw new NotFoundException(ITEM_NOT_FOUND);
    await this.deleteFileBestEffort(deleted.storageKey, `photo ${deleted.id} deleted by its owner`);
    this.logger.log(`Portfolio photo ${deleted.id} deleted by provider ${providerId}`);
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  /** Same effect as the owner's delete, on anyone's photo. The admin is logged. */
  async deleteAsAdmin(adminUserId: string, itemId: string): Promise<void> {
    const deleted = await this.items.softDelete(itemId);
    if (!deleted) throw new NotFoundException(ITEM_NOT_FOUND);
    await this.deleteFileBestEffort(deleted.storageKey, `photo ${deleted.id} removed by an admin`);
    this.logger.warn(
      `Portfolio photo ${deleted.id} of provider ${deleted.serviceProviderId} removed by admin ${adminUserId}`,
    );
  }

  // ── Public ────────────────────────────────────────────────────────────────

  async listPublic(providerId: string): Promise<PublicPortfolioListDto> {
    if (!(await this.isProviderVisible(providerId))) {
      throw new NotFoundException(PROVIDER_NOT_FOUND);
    }
    const items = await this.items.findLiveByProvider(providerId);
    return { items: items.map((i) => PublicPortfolioItemDto.from(i)) };
  }

  /**
   * The image of a live photo whose provider is still visible. A deleted photo,
   * a hidden provider and a file missing from storage all read as the same 404.
   */
  async getPublicImage(itemId: string): Promise<PortfolioImageStream> {
    const item = await this.items.findLiveById(itemId);
    if (!item || !(await this.isProviderVisible(item.serviceProviderId))) {
      throw new NotFoundException(ITEM_NOT_FOUND);
    }
    try {
      const { stream } = await this.storage.getStream(item.storageKey);
      return { stream, contentType: item.contentType, byteSize: item.byteSize };
    } catch (err) {
      // A live row whose file is gone: logged (it should not happen), but the
      // caller only learns « not found » — never the key nor the storage error.
      this.logger.error(
        `Portfolio photo ${item.id} is live but its file cannot be read`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new NotFoundException(ITEM_NOT_FOUND);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** The caller's own INDIVIDUAL provider (paused included), like `GET /service-providers/me`. */
  private async resolveOwnProviderId(userId: string): Promise<string> {
    const provider = await this.providers.findByUserId(userId);
    if (!provider) throw new NotFoundException(PROVIDER_NOT_FOUND);
    return provider.id;
  }

  /** The exact condition of the public profile: exists and not soft-deleted. */
  private async isProviderVisible(providerId: string): Promise<boolean> {
    return (await this.providers.findById(providerId)) !== null;
  }

  private async deleteFileBestEffort(storageKey: string, why: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (err) {
      this.logger.error(
        // The key is in the SERVER log only — it is what the person cleaning up
        // needs, and it never reaches a response.
        `Portfolio file ${storageKey} could not be deleted from storage (${why}); remove it by hand`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
