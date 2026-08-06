import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceProvider } from '../../service-providers/entities/service-provider.entity';
import { ServiceRequest } from '../../service-requests/entities/service-request.entity';
import { User } from '../../users/entities/user.entity';
import { NotificationType } from '../enums/notification-type.enum';

/**
 * A notification is addressed to exactly one recipient — a provider or a user,
 * never both, never neither. The CHECK mirrors the one installed by migration
 * 1780470000000; without this mirror the next `migration:generate` would
 * propose dropping it.
 */
@Entity({ name: 'notifications' })
@Check(
  'chk_notifications_single_recipient',
  `num_nonnulls("recipient_user_id", "recipient_service_provider_id") = 1`,
)
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  recipientServiceProviderId!: string | null;

  @ManyToOne(() => ServiceProvider, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'recipient_service_provider_id' })
  recipientServiceProvider!: ServiceProvider | null;

  @Column({ type: 'uuid', nullable: true })
  recipientUserId!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'recipient_user_id' })
  recipientUser!: User | null;

  @Column({
    type: 'enum',
    enum: NotificationType,
    enumName: 'notification_type',
  })
  type!: NotificationType;

  @Column({ type: 'uuid', nullable: true })
  serviceRequestId!: string | null;

  @ManyToOne(() => ServiceRequest, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'service_request_id' })
  serviceRequest!: ServiceRequest | null;

  /**
   * Comment mirrored from migration 1780470000000 — without the mirror, the
   * next `migration:generate` would propose dropping it.
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    comment:
      'Identifiers live in columns, not here: the recipient and the service request are real FKs, and readers join on them. Reserve this for what cannot be joined — a rendering hint, a snapshot of a value that will legitimately drift from its source. An id duplicated here is a second source of truth that nothing keeps in sync.',
  })
  data!: Record<string, unknown> | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  readAtUtc!: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
