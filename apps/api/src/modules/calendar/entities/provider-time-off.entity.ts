import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceProvider } from '../../service-providers/entities/service-provider.entity';

/**
 * A blocked period of a provider. See migration
 * `1780570000000-CreateProviderCalendar`. Decorators are MIRRORS of the
 * migration (see `ProviderCalendar`).
 */
@Entity({
  name: 'provider_time_off',
  comment:
    'Blocked periods of a provider (no appointment taken). Soft-deleted. At most 50 live periods not yet over per provider, enforced by the service under SELECT FOR UPDATE on the provider row (a count cannot be a CHECK).',
})
@Index('ix_provider_time_off_provider_ends_active', ['serviceProviderId', 'endsAtUtc'], {
  where: '"deleted_at_utc" IS NULL',
})
@Check('chk_provider_time_off_period', `"ends_at_utc" > "starts_at_utc"`)
@Check(
  'chk_provider_time_off_label_length',
  `"label" IS NULL OR char_length("label") BETWEEN 1 AND 80`,
)
export class ProviderTimeOff {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceProviderId!: string;

  @ManyToOne(() => ServiceProvider, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_provider_id' })
  serviceProvider!: ServiceProvider;

  @Column({ type: 'timestamp with time zone' })
  startsAtUtc!: Date;

  @Column({ type: 'timestamp with time zone' })
  endsAtUtc!: Date;

  @Column({
    type: 'varchar',
    length: 80,
    nullable: true,
    comment:
      'PRIVATE note of the provider. Never part of the public availability, which exposes free time only. Trimmed; an empty label is stored as NULL. The CHECK mirrors TIME_OFF_LABEL_MAX = 80.',
  })
  label!: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
