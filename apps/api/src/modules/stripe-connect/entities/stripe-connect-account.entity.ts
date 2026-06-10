import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceProvider } from '../../service-providers/entities/service-provider.entity';
import { StripeConnectAccountType } from '../enums/stripe-connect-account-type.enum';
import { StripeConnectOnboardingStatus } from '../enums/stripe-connect-onboarding-status.enum';

/**
 * 1:1 local mirror of a provider's Stripe Connect (Express) account. We never
 * treat Stripe as the source of truth at read time in 3.10a — the mirror is
 * kept fresh by the inline `account.updated` webhook handler. No soft-delete:
 * the Connect link is permanent for the provider's lifetime.
 */
@Entity({ name: 'stripe_connect_accounts' })
export class StripeConnectAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceProviderId!: string;

  @ManyToOne(() => ServiceProvider, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_provider_id' })
  serviceProvider!: ServiceProvider;

  @Column({ type: 'varchar' })
  stripeAccountId!: string;

  @Column({
    type: 'enum',
    enum: StripeConnectAccountType,
    enumName: 'stripe_connect_account_type',
    default: StripeConnectAccountType.EXPRESS,
  })
  accountType!: StripeConnectAccountType;

  @Column({
    type: 'enum',
    enum: StripeConnectOnboardingStatus,
    enumName: 'stripe_connect_onboarding_status',
    default: StripeConnectOnboardingStatus.NOT_STARTED,
  })
  onboardingStatus!: StripeConnectOnboardingStatus;

  @Column({ type: 'boolean', default: false })
  chargesEnabled!: boolean;

  @Column({ type: 'boolean', default: false })
  payoutsEnabled!: boolean;

  /** Snapshot of Stripe's `requirements.currently_due` (list of field keys). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  requirementsCurrentlyDue!: string[];

  @Column({ type: 'varchar', length: 2 })
  countryCode!: string;

  /** Stored UPPERCASE (ISO 4217); Stripe returns lowercase, normalized on write. */
  @Column({ type: 'varchar', length: 3 })
  defaultCurrency!: string;

  @Column({ type: 'timestamp with time zone', nullable: true })
  onboardedAtUtc!: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;
}
