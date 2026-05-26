import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { OrganizationMembershipsRepository } from './organization-memberships.repository';

@Module({
  imports: [TypeOrmModule.forFeature([OrganizationMembership])],
  providers: [OrganizationMembershipsRepository],
  exports: [OrganizationMembershipsRepository],
})
export class OrganizationMembershipsModule {}
