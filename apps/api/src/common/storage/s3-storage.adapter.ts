import { Readable } from 'stream';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  IStorageService,
  StorageGetResult,
  StorageUploadInput,
  StorageUploadResult,
} from './storage.interface';

/**
 * Prod adapter for S3-compatible object storage. Works with AWS S3
 * (ca-central-1) and Cloudflare R2 (via STORAGE_ENDPOINT). Implemented but not
 * exercised in dev (STORAGE_DRIVER=local).
 */
@Injectable()
export class S3StorageAdapter implements IStorageService {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.getOrThrow<string>('STORAGE_BUCKET');
    const endpoint = this.configService.get<string>('STORAGE_ENDPOINT');
    this.client = new S3Client({
      region: this.configService.getOrThrow<string>('STORAGE_REGION'),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>(
          'STORAGE_ACCESS_KEY_ID',
        ),
        secretAccessKey: this.configService.getOrThrow<string>(
          'STORAGE_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.buffer,
        ContentType: input.mimeType,
      }),
    );
    this.logger.debug(`Uploaded object to s3://${this.bucket}/${input.key}`);
    return { key: input.key };
  }

  async getStream(key: string): Promise<StorageGetResult> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return {
      stream: result.Body as Readable,
      mimeType: result.ContentType,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
