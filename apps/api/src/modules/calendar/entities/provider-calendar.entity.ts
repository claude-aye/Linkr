import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceProvider } from '../../service-providers/entities/service-provider.entity';

/**
 * Calendar settings of a provider. See migration
 * `1780570000000-CreateProviderCalendar`.
 *
 * The `@Unique`, `@Index`, `@Check` and `comment` options are MIRRORS of what
 * the migration installs. They do nothing at runtime (every read goes through
 * the repository, in raw SQL); they exist so a future `migration:generate`
 * does not propose to drop them.
 */
@Entity({
  name: 'provider_calendars',
  comment:
    'Calendar settings of a provider, one row each, created on first write: time zone, published weekly opening hours, iCal feed token hash. Appointments are NOT stored here: they are read live from service_requests. No deleted_at_utc on purpose (settings row mutated in place); every read requires the provider to be live.',
})
@Unique('uq_provider_calendars_provider', ['serviceProviderId'])
@Index('ux_provider_calendars_feed_token_hash', ['feedTokenHash'], {
  unique: true,
  where: '"feed_token_hash" IS NOT NULL',
})
@Check('chk_provider_calendars_weekly_hours_array', `jsonb_typeof("weekly_hours") = 'array'`)
@Check(
  'chk_provider_calendars_feed_token_paired',
  `("feed_token_hash" IS NULL) = ("feed_token_created_at_utc" IS NULL)`,
)
export class ProviderCalendar {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceProviderId!: string;

  @ManyToOne(() => ServiceProvider, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_provider_id' })
  serviceProvider!: ServiceProvider;

  @Column({
    type: 'varchar',
    length: 64,
    default: 'America/Toronto',
    comment:
      'IANA zone NAME (never an offset): the wall clock weekly_hours is expressed in.',
  })
  timeZone!: string;

  @Column({
    type: 'jsonb',
    default: () => `'[]'::jsonb`,
    comment:
      'Published weekly schedule: JSON array of {weekday, startMinute, endMinute}. ISO weekday (1 = Monday), minutes after local midnight in time_zone, quarter-hours, no overlap within a day. Validated by the service (normaliseWeeklyHours); an empty array means no schedule is published.',
  })
  weeklyHours!: unknown;

  @Column({
    type: 'char',
    length: 64,
    nullable: true,
    comment:
      'SHA-256 (hex) of the iCal feed token. The token itself is shown once and never stored. NULL = no feed. Replaced on regeneration, which revokes the previous URL.',
  })
  feedTokenHash!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  feedTokenCreatedAtUtc!: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;
}
