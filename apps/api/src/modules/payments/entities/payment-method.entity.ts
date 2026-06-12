import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { PaymentMethodType } from '../enums/payment-method-type.enum';

/**
 * A saved Stripe payment method, polymorphically owned by either a user (B2C
 * client) or an organization (B2B). Exactly one owner column is non-null
 * (DB CHECK). Soft-deleted via `deleted_at_utc`; there is no `updated_at_utc`.
 *
 * 3.10b only ever creates user-owned methods — org ownership is reserved for
 * the B2B subscription phase.
 */
@Entity({ name: 'payment_methods' })
export class PaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  ownerUserId!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'owner_user_id' })
  ownerUser!: User | null;

  @Column({ type: 'uuid', nullable: true })
  ownerOrganizationId!: string | null;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'owner_organization_id' })
  ownerOrganization!: Organization | null;

  @Column({ type: 'varchar' })
  stripePaymentMethodId!: string;

  @Column({
    type: 'enum',
    enum: PaymentMethodType,
    enumName: 'payment_method_type',
  })
  type!: PaymentMethodType;

  @Column({ type: 'varchar', nullable: true })
  brand!: string | null;

  @Column({ type: 'varchar', length: 4 })
  last4!: string;

  @Column({ type: 'smallint', nullable: true })
  expMonth!: number | null;

  @Column({ type: 'smallint', nullable: true })
  expYear!: number | null;

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
