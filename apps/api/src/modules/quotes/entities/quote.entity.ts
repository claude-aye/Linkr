import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceRequest } from '../../service-requests/entities/service-request.entity';
import { ServiceProvider } from '../../service-providers/entities/service-provider.entity';
import { QuoteStatus } from '../enums/quote-status.enum';

/**
 * A Pro's response to a PROJECT_TENDER request. Immutable once submitted —
 * to change terms a provider WITHDRAWs and resubmits. The full lifecycle is
 * carried by `status` (no soft-delete column).
 */
@Entity({ name: 'quotes' })
export class Quote {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceRequestId!: string;

  @ManyToOne(() => ServiceRequest, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_request_id' })
  serviceRequest!: ServiceRequest;

  @Column({ type: 'uuid' })
  serviceProviderId!: string;

  @ManyToOne(() => ServiceProvider, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_provider_id' })
  serviceProvider!: ServiceProvider;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'int' })
  estimatedDurationMinutes!: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  proposedStartAtUtc!: Date | null;

  @Column({ type: 'text' })
  description!: string;

  @Column({
    type: 'enum',
    enum: QuoteStatus,
    enumName: 'quote_status',
    default: QuoteStatus.SUBMITTED,
  })
  status!: QuoteStatus;

  @Column({ type: 'timestamp with time zone' })
  validUntilUtc!: Date;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;
}
