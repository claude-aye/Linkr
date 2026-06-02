import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UsersModule } from '../users/users.module';
import { ServicesCatalogModule } from '../services-catalog/services-catalog.module';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { VerificationDocument } from './entities/verification-document.entity';
import { VerificationDocumentRepository } from './repositories/verification-document.repository';
import { VerificationsService } from './verifications.service';
import { VerificationsController } from './verifications.controller';
import { AdminVerificationsController } from './admin-verifications.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([VerificationDocument]),
    UsersModule,
    ServicesCatalogModule,
    ServiceProvidersModule,
  ],
  controllers: [VerificationsController, AdminVerificationsController],
  providers: [VerificationDocumentRepository, VerificationsService, AdminGuard],
  exports: [VerificationsService],
})
export class VerificationsModule {}
