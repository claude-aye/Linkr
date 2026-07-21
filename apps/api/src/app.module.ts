import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { validate } from './config/env.validation';
import { getDatabaseConfig } from './config/database.config';
import { getRedisConfig } from './config/redis.config';
import { StorageModule } from './common/storage/storage.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { OrganizationMembershipsModule } from './modules/organization-memberships/organization-memberships.module';
import { ServicesCatalogModule } from './modules/services-catalog/services-catalog.module';
import { ServiceProvidersModule } from './modules/service-providers/service-providers.module';
import { VerificationsModule } from './modules/verifications/verifications.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ServiceRequestsModule } from './modules/service-requests/service-requests.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { StripeConnectModule } from './modules/stripe-connect/stripe-connect.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { StripeWebhooksModule } from './modules/stripe-webhooks/stripe-webhooks.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';

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
    ScheduleModule.forRoot(),
    StorageModule,
    HealthModule,
    UsersModule,
    AuthModule,
    OrganizationsModule,
    OrganizationMembershipsModule,
    ServicesCatalogModule,
    ServiceProvidersModule,
    VerificationsModule,
    NotificationsModule,
    ServiceRequestsModule,
    QuotesModule,
    StripeConnectModule,
    PaymentsModule,
    StripeWebhooksModule,
    GeocodingModule,
  ],
})
export class AppModule {}
