import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UsersModule } from '../users/users.module';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceRequest } from './entities/service-request.entity';
import { ServiceRequestRepository } from './repositories/service-request.repository';
import { ServiceRequestsService } from './service-requests.service';
import { ServiceRequestsController } from './service-requests.controller';
import { AdminServiceRequestsController } from './admin-service-requests.controller';
import { ServiceRequestsCron } from './service-requests.cron';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceRequest]),
    UsersModule,
    ServiceProvidersModule,
    NotificationsModule,
  ],
  controllers: [ServiceRequestsController, AdminServiceRequestsController],
  providers: [
    ServiceRequestRepository,
    ServiceRequestsService,
    ServiceRequestsCron,
    AdminGuard,
  ],
  exports: [ServiceRequestsService],
})
export class ServiceRequestsModule {}
