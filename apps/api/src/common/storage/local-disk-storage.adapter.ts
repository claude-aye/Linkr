import { createReadStream, promises as fs } from 'fs';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IStorageService,
  StorageGetResult,
  StorageUploadInput,
  StorageUploadResult,
} from './storage.interface';

/**
 * Dev adapter that persists objects under STORAGE_LOCAL_DIR. The `key` is a
 * relative path; the absolute on-disk location is derived from the base dir.
 */
@Injectable()
export class LocalDiskStorageAdapter implements IStorageService {
  private readonly logger = new Logger(LocalDiskStorageAdapter.name);
  private readonly baseDir: string;

  constructor(private readonly configService: ConfigService) {
    const dir = this.configService.get<string>(
      'STORAGE_LOCAL_DIR',
      './storage/uploads',
    );
    this.baseDir = resolve(dir);
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const absolutePath = this.resolveKey(input.key);
    await fs.mkdir(dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.buffer);
    this.logger.debug(`Stored object at key=${input.key}`);
    return { key: input.key };
  }

  async getStream(key: string): Promise<StorageGetResult> {
    const absolutePath = this.resolveKey(key);
    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException('Stored file not found');
    }
    return { stream: createReadStream(absolutePath) };
  }

  async delete(key: string): Promise<void> {
    const absolutePath = this.resolveKey(key);
    try {
      await fs.unlink(absolutePath);
    } catch (err) {
      // Idempotent delete — ABSENCE, and only absence, is not an error.
      //
      // ⚠️ This used to swallow EVERY failure as a « no-op for missing key »
      // at debug level. Measured by the portfolio probe (P1): on Windows, a
      // file still open by a reader fails with EPERM, and the delete silently
      // did nothing while reporting success. For a photo that must stop
      // existing (Loi 25), a failed delete has to reach the caller, which logs
      // it loudly. The adapter had no caller of `delete` before the portfolio.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.debug(`Delete no-op for missing key=${key}`);
        return;
      }
      throw err;
    }
  }

  /** Resolves a relative key to an absolute path, guarding against traversal. */
  private resolveKey(key: string): string {
    if (isAbsolute(key)) {
      throw new NotFoundException('Invalid storage key');
    }
    const absolutePath = normalize(join(this.baseDir, key));
    if (
      absolutePath !== this.baseDir &&
      !absolutePath.startsWith(this.baseDir + sep)
    ) {
      throw new NotFoundException('Invalid storage key');
    }
    return absolutePath;
  }
}
