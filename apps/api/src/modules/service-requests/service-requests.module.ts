import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UsersModule } from '../users/users.module';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { ServiceRequest } from './entities/service-request.entity';
import { ServiceRequestAssignment } from './entities/service-request-assignment.entity';
import { ServiceRequestAttachment } from './entities/service-request-attachment.entity';
import { ServiceRequestRepository } from './repositories/service-request.repository';
import { ServiceRequestAssignmentRepository } from './repositories/service-request-assignment.repository';
import { ServiceRequestAttachmentRepository } from './repositories/service-request-attachment.repository';
import { ServiceRequestsService } from './service-requests.service';
import { ServiceRequestAttachmentsService } from './service-request-attachments.service';
import { ServiceRequestsController } from './service-requests.controller';
import { ServiceRequestAttachmentsController } from './service-request-attachments.controller';
import { AdminServiceRequestsController } from './admin-service-requests.controller';
import { ServiceRequestsCron } from './service-requests.cron';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceRequest,
      ServiceRequestAssignment,
      ServiceRequestAttachment,
    ]),
    UsersModule,
    ServiceProvidersModule,
    NotificationsModule,
    // PaymentsService → payability guard (assertPayable) + deposit capture.
    PaymentsModule,
  ],
  controllers: [
    ServiceRequestsController,
    ServiceRequestAttachmentsController,
    AdminServiceRequestsController,
  ],
  providers: [
    ServiceRequestRepository,
    ServiceRequestAssignmentRepository,
    ServiceRequestAttachmentRepository,
    ServiceRequestsService,
    ServiceRequestAttachmentsService,
    ServiceRequestsCron,
    AdminGuard,
  ],
  exports: [ServiceRequestsService],
})
export class ServiceRequestsModule {}
