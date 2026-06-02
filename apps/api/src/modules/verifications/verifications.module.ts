import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { ServicesCatalogModule } from '../services-catalog/services-catalog.module';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { VerificationDocument } from './entities/verification-document.entity';
import { VerificationDocumentRepository } from './repositories/verification-document.repository';
import { VerificationsService } from './verifications.service';
import { VerificationsController } from './verifications.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([VerificationDocument]),
    UsersModule,
    ServicesCatalogModule,
    ServiceProvidersModule,
  ],
  controllers: [VerificationsController],
  providers: [VerificationDocumentRepository, VerificationsService],
  exports: [VerificationsService],
})
export class VerificationsModule {}
