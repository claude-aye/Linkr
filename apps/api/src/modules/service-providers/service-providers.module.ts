import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrganizationMembershipsModule } from '../organization-memberships/organization-memberships.module';
import { ServiceProvider } from './entities/service-provider.entity';
import { ServiceProviderRepository } from './repositories/service-provider.repository';
import { ServiceProvidersService } from './service-providers.service';
import { ServiceProvidersController } from './service-providers.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceProvider]),
    UsersModule,
    OrganizationsModule,
    OrganizationMembershipsModule,
  ],
  controllers: [ServiceProvidersController],
  providers: [ServiceProviderRepository, ServiceProvidersService],
  exports: [ServiceProviderRepository, ServiceProvidersService],
})
export class ServiceProvidersModule {}
