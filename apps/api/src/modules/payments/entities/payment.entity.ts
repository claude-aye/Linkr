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
import { User } from '../../users/entities/user.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { ServiceProvider } from '../../service-providers/entities/service-provider.entity';
import { PaymentMethod } from './payment-method.entity';
import { PaymentType } from '../enums/payment-type.enum';
import { PaymentStatus } from '../enums/payment-status.enum';

/**
 * A single service-payment transaction. A typical service request has two
 * rows: one DEPOSIT (20% at ASSIGNED) and one BALANCE (80% at COMPLETED).
 *
 * Monetary fields are decimal(12,2) paired with an UPPERCASE ISO 4217
 * `currency`; the accounting invariant
 * `provider_net_amount = gross_amount - platform_fee_amount - tax_amount`
 * is enforced by a DB CHECK. No soft-delete (payments are immutable history).
 */
@Entity({ name: 'payments' })
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceRequestId!: string;

  @ManyToOne(() => ServiceRequest, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_request_id' })
  serviceRequest!: ServiceRequest;

  @Column({
    type: 'enum',
    enum: PaymentType,
    enumName: 'payment_type',
  })
  paymentType!: PaymentType;

  @Column({ type: 'uuid' })
  payerUserId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payer_user_id' })
  payerUser!: User;

  @Column({ type: 'uuid', nullable: true })
  payerOrganizationId!: string | null;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'payer_organization_id' })
  payerOrganization!: Organization | null;

  @Column({ type: 'uuid' })
  recipientServiceProviderId!: string;

  @ManyToOne(() => ServiceProvider, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'recipient_service_provider_id' })
  recipientServiceProvider!: ServiceProvider;

  @Column({ type: 'uuid' })
  paymentMethodId!: string;

  @ManyToOne(() => PaymentMethod, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_method_id' })
  paymentMethod!: PaymentMethod;

  @Column({ type: 'varchar', nullable: true })
  stripePaymentIntentId!: string | null;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'payment_status',
    default: PaymentStatus.PENDING,
  })
  status!: PaymentStatus;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  grossAmount!: string;

  /** ISO 4217, stored UPPERCASE. */
  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  /** Snapshot at payment time. NULL for B2B (no commission); 10.00 for B2C. */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  commissionRatePercent!: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  platformFeeAmount!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  taxAmount!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  providerNetAmount!: string;

  @Column({ type: 'timestamp with time zone', nullable: true })
  capturedAtUtc!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  failedAtUtc!: Date | null;

  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;
}
