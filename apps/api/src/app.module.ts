import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { validate } from './config/env.validation';
import { getDatabaseConfig } from './config/database.config';
import { getRedisConfig } from './config/redis.config';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { OrganizationMembershipsModule } from './modules/organization-memberships/organization-memberships.module';
import { ServicesCatalogModule } from './modules/services-catalog/services-catalog.module';
import { ServiceProvidersModule } from './modules/service-providers/service-providers.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      validate,
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getDatabaseConfig,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getRedisConfig,
    }),
    HealthModule,
    UsersModule,
    AuthModule,
    OrganizationsModule,
    OrganizationMembershipsModule,
    ServicesCatalogModule,
    ServiceProvidersModule,
  ],
})
export class AppModule {}
