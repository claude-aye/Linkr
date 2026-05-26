import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { OrganizationMembershipsController } from './organization-memberships.controller';
import { OrganizationMembershipsRepository } from './organization-memberships.repository';
import { OrganizationMembershipsService } from './organization-memberships.service';
import { OrganizationRoleGuard } from './guards/organization-role.guard';

@Module({
  imports: [TypeOrmModule.forFeature([OrganizationMembership]), UsersModule],
  controllers: [OrganizationMembershipsController],
  providers: [
    OrganizationMembershipsRepository,
    OrganizationMembershipsService,
    OrganizationRoleGuard,
  ],
  exports: [OrganizationMembershipsRepository, OrganizationRoleGuard],
})
export class OrganizationMembershipsModule {}
