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
    } catch {
      // Idempotent delete — absence is not an error.
      this.logger.debug(`Delete no-op for missing key=${key}`);
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
