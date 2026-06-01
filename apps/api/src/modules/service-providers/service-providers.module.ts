import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrganizationMembershipsModule } from '../organization-memberships/organization-memberships.module';
import { ServiceProvider } from './entities/service-provider.entity';
import { ProfessionalServiceZone } from './entities/professional-service-zone.entity';
import { ServiceProviderRepository } from './repositories/service-provider.repository';
import { ProfessionalServiceZoneRepository } from './repositories/professional-service-zone.repository';
import { ServiceProvidersService } from './service-providers.service';
import { ServiceProvidersController } from './service-providers.controller';
import { ServiceZonesController } from './service-zones.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceProvider, ProfessionalServiceZone]),
    UsersModule,
    OrganizationsModule,
    OrganizationMembershipsModule,
  ],
  controllers: [ServiceProvidersController, ServiceZonesController],
  providers: [
    ServiceProviderRepository,
    ProfessionalServiceZoneRepository,
    ServiceProvidersService,
  ],
  exports: [ServiceProviderRepository, ServiceProvidersService],
})
export class ServiceProvidersModule {}
