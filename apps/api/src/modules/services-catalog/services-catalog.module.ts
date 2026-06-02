import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UsersModule } from '../users/users.module';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceItem } from './entities/service-item.entity';
import { RegulatoryRequirement } from './entities/regulatory-requirement.entity';
import { ServiceCategoryRepository } from './repositories/service-category.repository';
import { ServiceItemRepository } from './repositories/service-item.repository';
import { RegulatoryRequirementRepository } from './repositories/regulatory-requirement.repository';
import { ServicesCatalogService } from './services-catalog.service';
import { ServicesCatalogController, ServiceItemSuggestionController } from './services-catalog.controller';
import { ServicesCatalogPublicController } from './services-catalog.public.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceCategory, ServiceItem, RegulatoryRequirement]),
    UsersModule,
  ],
  controllers: [ServiceItemSuggestionController, ServicesCatalogController, ServicesCatalogPublicController],
  providers: [
    ServiceCategoryRepository,
    ServiceItemRepository,
    RegulatoryRequirementRepository,
    ServicesCatalogService,
    AdminGuard,
  ],
  exports: [
    ServiceCategoryRepository,
    ServiceItemRepository,
    RegulatoryRequirementRepository,
    ServicesCatalogService,
  ],
})
export class ServicesCatalogModule {}
