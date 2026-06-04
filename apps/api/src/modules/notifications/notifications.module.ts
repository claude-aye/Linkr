import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { Notification } from './entities/notification.entity';
import { NotificationsRepository } from './repositories/notifications.repository';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    ServiceProvidersModule,
  ],
  providers: [NotificationsRepository, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
