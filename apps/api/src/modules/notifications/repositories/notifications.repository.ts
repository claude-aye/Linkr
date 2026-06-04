import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { NotificationType } from '../enums/notification-type.enum';

export interface CreateNotificationData {
  recipientServiceProviderId: string;
  type: NotificationType;
  serviceRequestId: string | null;
  data: Record<string, unknown> | null;
}

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  /** Batch-insert notifications inside the provided transaction manager. */
  async insertBatch(
    items: CreateNotificationData[],
    manager: EntityManager,
  ): Promise<void> {
    if (items.length === 0) return;

    const notifRepo = manager.getRepository(Notification);
    const entities = items.map((item) => {
      const n = notifRepo.create();
      n.recipientServiceProviderId = item.recipientServiceProviderId;
      n.type = item.type;
      n.serviceRequestId = item.serviceRequestId;
      n.data = item.data;
      n.readAtUtc = null;
      return n;
    });

    await notifRepo.save(entities);
  }
}
