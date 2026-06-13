import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Payment } from './payment.entity';
import { RefundStatus } from '../enums/refund-status.enum';

/**
 * An admin-initiated refund against a {@link Payment}. Supports partial refunds
 * (multiple rows per payment); `amount` is paired with an UPPERCASE ISO 4217
 * `currency` that must equal the parent payment's currency (service-enforced).
 *
 * Like {@link Payment}, refunds are immutable history — there is NO soft-delete
 * column. Final settlement (status) is driven by the Stripe webhook worker.
 */
@Entity({ name: 'refunds' })
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  paymentId!: string;

  @ManyToOne(() => Payment, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_id' })
  payment!: Payment;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount!: string;

  /** ISO 4217, stored UPPERCASE; equals the parent payment's currency. */
  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'text' })
  reason!: string;

  /** The admin who initiated the refund. */
  @Column({ type: 'uuid' })
  initiatedByUserId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'initiated_by_user_id' })
  initiatedByUser!: User;

  @Column({
    type: 'enum',
    enum: RefundStatus,
    enumName: 'refund_status',
    default: RefundStatus.PENDING,
  })
  status!: RefundStatus;

  @Column({ type: 'varchar', nullable: true })
  stripeRefundId!: string | null;

  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;
}
