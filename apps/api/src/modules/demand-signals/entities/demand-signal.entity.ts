import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ServiceCategory } from '../../services-catalog/entities/service-category.entity';

/**
 * One anonymous demand signal: a search that found nobody.
 *
 * ⚠️ NO USER REFERENCE — and it is the point, not an omission. See the class
 * comment on migration 1780510000000: the absence of any link to a person is
 * what keeps a row from being personal information. Do not add a `userId`, an
 * IP, or a session id here, nullable or otherwise.
 *
 * ⚠️ NO `deletedAtUtc`, NO `updatedAtUtc`. Nothing updates a row and no owner
 * can ask for one to be erased — the same append-only-history reasoning already
 * documented for `payments` and `refunds`, not an oversight of the
 * soft-delete-everywhere rule.
 *
 * The declaration exists for SCHEMA COHERENCE (without it the next
 * `migration:generate` would propose dropping the table) and to register the
 * entity through `TypeOrmModule.forFeature` so the repository can be injected —
 * the insert itself is raw SQL, exactly like the rest of this codebase.
 *
 * ⚠️ THE MIRRORS BELOW ARE LOAD-BEARING, AND THEIR ABSENCE WAS MEASURED, NOT
 * GUESSED. Everything migration 1780510000000 installs that TypeORM cannot infer
 * from a plain column — the table comment, the two CHECKs, the index and the two
 * column comments — has to be restated here. Run without them,
 * `migration:generate` proposed an `up()` that DROPPED the index, both CHECK
 * constraints and the table comment; the column comments, already mirrored, were
 * left alone. Same discipline as `Notification`'s `@Check` and `data` comment.
 * Delete a mirror and the next generated migration quietly proposes deleting
 * what it mirrors.
 *
 * (The FK rename `migration:generate` also proposes is the repository-wide noise
 * it applies to every hand-named foreign key — pre-existing, not this table's.)
 */
@Entity({
  name: 'demand_signals',
  comment:
    'Anonymous demand signal: a search that returned zero providers. Deliberately carries NO user reference, no IP and no session id — the absence of any link is what keeps a row from being personal information, and what lets it be kept with no retention clock. Do not add one: an identified follow-up ("notify me") is a different table, with consent.',
})
@Index('ix_demand_signals_category_created', ['serviceCategoryId', 'createdAtUtc'])
@Check('chk_demand_signals_sector_lat', `"sector_lat" >= -90 AND "sector_lat" <= 90`)
@Check('chk_demand_signals_sector_lng', `"sector_lng" >= -180 AND "sector_lng" <= 180`)
export class DemandSignal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceCategoryId!: string;

  @ManyToOne(() => ServiceCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_category_id' })
  serviceCategory!: ServiceCategory;

  /**
   * Coarse sector latitude — NOT the searched point.
   *
   * Typed `string` because that is what node-postgres returns for `numeric`, and
   * nothing reads this column yet; typing it `number` would be a lie on the read
   * path the day one appears. Comment mirrored from the migration — without the
   * mirror, the next `migration:generate` would propose dropping it.
   */
  @Column({
    type: 'numeric',
    precision: 4,
    scale: 2,
    comment:
      'Coarse sector, NOT the searched point. numeric(4,2) is load-bearing: at scale 2 the column cannot hold a finer value, so the coarseness survives a caller that sends an exact coordinate (~1.1 km cell).',
  })
  sectorLat!: string;

  /** Coarse sector longitude — NOT the searched point. See `sectorLat`. */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    comment:
      'Coarse sector, NOT the searched point. numeric(5,2) is load-bearing: at scale 2 the column cannot hold a finer value, so the coarseness survives a caller that sends an exact coordinate (~0.76 km at Quebec latitude).',
  })
  sectorLng!: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;
}
