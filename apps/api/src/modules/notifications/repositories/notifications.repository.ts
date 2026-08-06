import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { NotificationType } from '../enums/notification-type.enum';

/**
 * Exactly one of the two recipients is set — the database enforces it
 * (`chk_notifications_single_recipient`). Both are required fields rather than
 * optional ones so that a new call site has to state which kind of recipient it
 * is addressing, instead of silently defaulting to neither.
 */
export interface CreateNotificationData {
  recipientServiceProviderId: string | null;
  recipientUserId: string | null;
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
    const entities = items.map((item) => this.toEntity(notifRepo, item));

    await notifRepo.save(entities);
  }

  /**
   * Insert a single notification. No transaction: one row is already atomic,
   * and unlike {@link insertBatch} there is no sibling row it has to land with.
   */
  async insertOne(item: CreateNotificationData): Promise<void> {
    await this.repo.save(this.toEntity(this.repo, item));
  }

  private toEntity(
    notifRepo: Repository<Notification>,
    item: CreateNotificationData,
  ): Notification {
    const n = notifRepo.create();
    n.recipientServiceProviderId = item.recipientServiceProviderId;
    n.recipientUserId = item.recipientUserId;
    n.type = item.type;
    n.serviceRequestId = item.serviceRequestId;
    n.data = item.data;
    n.readAtUtc = null;
    return n;
  }
}
