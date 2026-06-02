import { Global, Logger, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_SERVICE, IStorageService } from './storage.interface';
import { LocalDiskStorageAdapter } from './local-disk-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';

const storageProvider: Provider = {
  provide: STORAGE_SERVICE,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): IStorageService => {
    const driver = configService.get<string>('STORAGE_DRIVER', 'local');
    const logger = new Logger('StorageModule');
    if (driver === 's3') {
      logger.log('Using S3 storage adapter');
      return new S3StorageAdapter(configService);
    }
    logger.log('Using local-disk storage adapter');
    return new LocalDiskStorageAdapter(configService);
  },
};

@Global()
@Module({
  providers: [storageProvider],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
