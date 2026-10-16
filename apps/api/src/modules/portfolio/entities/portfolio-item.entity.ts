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
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceProvider } from '../../service-providers/entities/service-provider.entity';

/**
 * A portfolio photo (P1). See migration `1780550000000-CreatePortfolioItems`.
 *
 * The `@Index`, `@Unique`, `@Check` and `comment` options are MIRRORS of what
 * the migration installs. They do nothing at runtime (every read goes through
 * the repository); they exist so a future `migration:generate` does not
 * propose to drop them.
 */
@Entity({
  name: 'portfolio_items',
  comment:
    'Portfolio photos of a provider. Every value describes the RE-ENCODED file (WebP, metadata stripped), never the upload. At most 12 live rows per provider, enforced by the service under SELECT FOR UPDATE on the provider row (a count cannot be a CHECK). No unique constraint on position, on purpose (reordering rewrites them all). Soft-deleted, AND the file is deleted from storage at the same time (Loi 25).',
})
@Unique('uq_portfolio_items_storage_key', ['storageKey'])
@Index(
  'ix_portfolio_items_provider_position_active',
  ['serviceProviderId', 'position'],
  { where: '"deleted_at_utc" IS NULL' },
)
@Check(
  'chk_portfolio_items_caption_length',
  `"caption" IS NULL OR char_length("caption") BETWEEN 1 AND 140`,
)
@Check('chk_portfolio_items_position', `"position" >= 0`)
@Check(
  'chk_portfolio_items_dimensions',
  `"width" > 0 AND "height" > 0 AND "byte_size" > 0`,
)
export class PortfolioItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceProviderId!: string;

  @ManyToOne(() => ServiceProvider, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_provider_id' })
  serviceProvider!: ServiceProvider;

  @Column({
    type: 'text',
    comment:
      'Relative storage key, portfolio/{providerId}/{uuid}.webp. NEVER exposed in any response: the public read streams the file, and the browser only sees /media/portfolio/{id} on the web origin. Points at nothing once the row is soft-deleted (the file is deleted with it).',
  })
  storageKey!: string;

  @Column({
    type: 'varchar',
    length: 140,
    nullable: true,
    comment:
      "Trimmed before storage; an empty caption is stored as NULL, never as ''. The CHECK mirrors PORTFOLIO_CAPTION_MAX = 140.",
  })
  caption!: string | null;

  @Column({
    type: 'integer',
    comment:
      "Display order, 0-based. Not unique on purpose; ties read by created_at_utc. A new photo goes at max + 1; reordering rewrites the provider's live rows to 0..n-1.",
  })
  position!: number;

  @Column({ type: 'text' })
  contentType!: string;

  @Column({ type: 'integer' })
  width!: number;

  @Column({ type: 'integer' })
  height!: number;

  @Column({ type: 'integer' })
  byteSize!: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
