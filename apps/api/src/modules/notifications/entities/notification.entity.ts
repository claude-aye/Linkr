import {
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
import { NotificationType } from '../enums/notification-type.enum';

@Entity({ name: 'notifications' })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  recipientServiceProviderId!: string;

  @ManyToOne(() => ServiceProvider, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'recipient_service_provider_id' })
  recipientServiceProvider!: ServiceProvider;

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

  @Column({ type: 'jsonb', nullable: true })
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
