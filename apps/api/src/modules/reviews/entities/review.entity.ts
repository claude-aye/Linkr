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
import { ServiceRequest } from '../../service-requests/entities/service-request.entity';
import { User } from '../../users/entities/user.entity';

/**
 * One review: a rating, an optional comment, and — from tranche 2 — the
 * provider's single reply, on the same row.
 *
 * Read the class comment on migration 1780520000000 before changing anything
 * here; it carries the reasoning for the unfalsifiable-by-construction shape,
 * the integer rating, the reply-as-a-column, and the partial unique index.
 *
 * The declaration exists for SCHEMA COHERENCE (without it the next
 * `migration:generate` would propose dropping the table) and to register the
 * entity through `TypeOrmModule.forFeature` so the repository can be injected —
 * reads and writes are raw SQL, exactly like the rest of this codebase.
 *
 * ⚠️ THE MIRRORS BELOW ARE LOAD-BEARING. Everything the migration installs that
 * TypeORM cannot infer from a plain column — the table comment, the four CHECKs,
 * the three partial indexes and the four column comments — has to be restated
 * here, or the next `migration:generate` quietly proposes deleting what is not
 * mirrored. Measured on `demand_signals` in session 6, where the un-mirrored
 * index, CHECKs and table comment were all proposed for removal.
 *
 * (The FK rename `migration:generate` also proposes is the repository-wide noise
 * it applies to every hand-named foreign key — pre-existing, not this table's.)
 */
@Entity({
  name: 'reviews',
  comment:
    "One review per COMPLETED service request, written by that request's client about that request's provider (D-1). Unfalsifiable by construction: both ends are FKs onto a row the reviewer cannot fabricate, which is why no moderation surface exists. Soft-deleted by its author (D-3); the provider reply is a column on this row (D-2), so deleting the review takes the reply with it with no cascade to write. The rating average and count are NEVER stored — they are computed at read time with deleted rows excluded inside the aggregate (D-4).",
})
@Index('ux_reviews_request_active', ['serviceRequestId'], {
  unique: true,
  where: '"deleted_at_utc" IS NULL',
})
@Index('ix_reviews_provider_active', ['serviceProviderId', 'createdAtUtc'], {
  where: '"deleted_at_utc" IS NULL',
})
@Index('ix_reviews_author_active', ['authorUserId'], {
  where: '"deleted_at_utc" IS NULL',
})
@Check('chk_reviews_rating_range', `"rating" >= 1 AND "rating" <= 5`)
@Check(
  'chk_reviews_comment_length',
  `"comment" IS NULL OR char_length(btrim("comment")) BETWEEN 1 AND 2000`,
)
@Check(
  'chk_reviews_response_length',
  `"provider_response" IS NULL OR char_length(btrim("provider_response")) BETWEEN 1 AND 2000`,
)
@Check(
  'chk_reviews_response_paired',
  `num_nonnulls("provider_response", "provider_responded_at_utc") <> 1`,
)
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceRequestId!: string;

  @ManyToOne(() => ServiceRequest, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_request_id' })
  serviceRequest!: ServiceRequest;

  /** The provider being reviewed — see the column comment. */
  @Column({
    type: 'uuid',
    comment:
      'The provider being reviewed. Resolved SERVER-SIDE from service_requests.assigned_service_provider_id at write time and never accepted from the request body. This is not a denormalized label in the sense CLAUDE.md forbids: it records WHO WAS REVIEWED, an immutable historical fact, so it must not follow a later re-assignment of the request.',
  })
  serviceProviderId!: string;

  @ManyToOne(() => ServiceProvider, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_provider_id' })
  serviceProvider!: ServiceProvider;

  /** The client of the reviewed request — the only one who may delete it. */
  @Column({ type: 'uuid' })
  authorUserId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_user_id' })
  author!: User;

  @Column({
    type: 'smallint',
    comment:
      "Integer 1..5, never a float (D-5). The CHECK rejects 0 and 6; note that PostgreSQL COERCES a fractional input into smallint (3.5 becomes 4) BEFORE any CHECK runs, so a non-integer is rejected one layer up, by the DTO's @IsInt() (400). No sub-ratings: not a column, not a table, not a preparation.",
  })
  rating!: number;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  /**
   * The provider's single reply (D-2). Nothing writes it until tranche 2 — see
   * the column comment and the migration.
   */
  @Column({
    type: 'text',
    nullable: true,
    comment:
      'The provider\'s single reply (D-2). A COLUMN, never a second entity: "at most one reply" is then a property of the schema, and "deleting a review takes its reply with it" (D-3) is a property of soft-deleting the row. Posed by migration 1780520000000; nothing writes it until tranche 2, and it is deliberately absent from the response DTOs until then.',
  })
  providerResponse!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  providerRespondedAtUtc!: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({
    type: 'timestamp with time zone',
    nullable: true,
    comment:
      'Soft delete, exercised by the AUTHOR (D-3). Load-bearing twice over: it is the predicate of the partial unique index (deleting frees the slot, so "delete then rewrite" replaces the editing D-3 forbids), and it is what the rating aggregate excludes.',
  })
  deletedAtUtc!: Date | null;
}
