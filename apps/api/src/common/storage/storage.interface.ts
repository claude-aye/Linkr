import { Readable } from 'stream';

/** Injection token for the active storage adapter. */
export const STORAGE_SERVICE = 'STORAGE_SERVICE';

export interface StorageUploadInput {
  buffer: Buffer;
  /** Relative storage key (local path / S3 object key). */
  key: string;
  mimeType: string;
}

export interface StorageUploadResult {
  key: string;
}

export interface StorageGetResult {
  stream: Readable;
  mimeType?: string;
}

/**
 * Port for binary object storage. Adapters: LocalDiskStorageAdapter (dev),
 * S3StorageAdapter (prod / S3-compatible). The `key` is a relative storage
 * key — never a public URL.
 */
export interface IStorageService {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  getStream(key: string): Promise<StorageGetResult>;
  delete(key: string): Promise<void>;
}
