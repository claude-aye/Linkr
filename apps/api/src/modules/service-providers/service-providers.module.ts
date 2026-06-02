import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrganizationMembershipsModule } from '../organization-memberships/organization-memberships.module';
import { ServicesCatalogModule } from '../services-catalog/services-catalog.module';
import { ServiceProvider } from './entities/service-provider.entity';
import { ProfessionalServiceZone } from './entities/professional-service-zone.entity';
import { ProfessionalServiceCategory } from './entities/professional-service-category.entity';
import { ProfessionalService } from './entities/professional-service.entity';
import { ServiceProviderRepository } from './repositories/service-provider.repository';
import { ProfessionalServiceZoneRepository } from './repositories/professional-service-zone.repository';
import { ProfessionalServiceCategoryRepository } from './repositories/professional-service-category.repository';
import { ProfessionalServiceRepository } from './repositories/professional-service.repository';
import { ServiceProvidersService } from './service-providers.service';
import { ProviderServicesService } from './provider-services.service';
import { ServiceProvidersController } from './service-providers.controller';
import { ServiceZonesController } from './service-zones.controller';
import { ProfessionalServiceCategoriesController } from './professional-service-categories.controller';
import {
  PscServicesController,
  ProviderServicesController,
} from './professional-services.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceProvider,
      ProfessionalServiceZone,
      ProfessionalServiceCategory,
      ProfessionalService,
    ]),
    UsersModule,
    OrganizationsModule,
    OrganizationMembershipsModule,
    ServicesCatalogModule,
  ],
  controllers: [
    ServiceProvidersController,
    ServiceZonesController,
    ProfessionalServiceCategoriesController,
    PscServicesController,
    ProviderServicesController,
  ],
  providers: [
    ServiceProviderRepository,
    ProfessionalServiceZoneRepository,
    ProfessionalServiceCategoryRepository,
    ProfessionalServiceRepository,
    ServiceProvidersService,
    ProviderServicesService,
  ],
  exports: [ServiceProviderRepository, ServiceProvidersService],
})
export class ServiceProvidersModule {}
