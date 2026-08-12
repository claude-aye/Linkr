import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ServiceCategory } from '../../services-catalog/entities/service-category.entity';
import { ServiceItem } from '../../services-catalog/entities/service-item.entity';
import { ServiceProvider } from '../../service-providers/entities/service-provider.entity';
import { ServiceRequestType } from '../enums/service-request-type.enum';
import { ServiceRequestStatus } from '../enums/service-request-status.enum';
import { ServiceRequestLocationPrecision } from '../enums/service-request-location-precision.enum';

/**
 * Unified entity for both DIRECT_BOOKING and PROJECT_TENDER requests.
 *
 * `serviceLocation` is `geometry(Point,4326)`, `select: false` — the
 * repository reads it via `ST_AsGeoJSON(...)` to avoid raw WKB.
 */
@Entity({ name: 'service_requests' })
export class ServiceRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  clientUserId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_user_id' })
  clientUser!: User;

  @Column({
    type: 'enum',
    enum: ServiceRequestType,
    enumName: 'service_request_type',
  })
  requestType!: ServiceRequestType;

  @Column({
    type: 'enum',
    enum: ServiceRequestStatus,
    enumName: 'service_request_status',
  })
  status!: ServiceRequestStatus;

  @Column({ type: 'uuid' })
  serviceCategoryId!: string;

  @ManyToOne(() => ServiceCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_category_id' })
  serviceCategory!: ServiceCategory;

  @Column({ type: 'uuid', nullable: true })
  serviceItemId!: string | null;

  @ManyToOne(() => ServiceItem, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'service_item_id' })
  serviceItem!: ServiceItem | null;

  @Column({ type: 'uuid', nullable: true })
  requestedServiceProviderId!: string | null;

  @ManyToOne(() => ServiceProvider, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'requested_service_provider_id' })
  requestedServiceProvider!: ServiceProvider | null;

  @Column({ type: 'uuid', nullable: true })
  assignedServiceProviderId!: string | null;

  @ManyToOne(() => ServiceProvider, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'assigned_service_provider_id' })
  assignedServiceProvider!: ServiceProvider | null;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 500 })
  serviceAddress!: string;

  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    select: false,
  })
  serviceLocation!: object;

  /**
   * Provenance of `serviceLocation` — see the enum for why it is provenance and
   * not accuracy.
   *
   * ⚠️ The `default:` below NEVER RUNS. Every read of this table, and the INSERT
   * itself, go through hand-written raw SQL in `ServiceRequestRepository`, so
   * TypeORM's entity defaults are bypassed entirely. What actually assigns the
   * value is the repository's explicit `?? UNKNOWN`, backed by the column's
   * `DEFAULT 'UNKNOWN'` in PG (migration 1780500000000) for any writer that
   * omits the column. This declaration exists for schema coherence — so
   * `migration:generate` does not propose to drop the column — not because it
   * acts. Do not delete the PG default believing this line covers it.
   */
  @Column({
    type: 'enum',
    enum: ServiceRequestLocationPrecision,
    enumName: 'service_request_location_precision',
    name: 'service_location_precision',
    default: ServiceRequestLocationPrecision.UNKNOWN,
  })
  serviceLocationPrecision!: ServiceRequestLocationPrecision;

  @Column({ type: 'timestamp with time zone', nullable: true })
  desiredStartAtUtc!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  desiredEndAtUtc!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  scheduledAtUtc!: Date | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  estimatedAmount!: string | null;

  @Column({ type: 'char', length: 3, nullable: true })
  estimatedCurrency!: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  finalAmount!: string | null;

  @Column({ type: 'char', length: 3, nullable: true })
  finalCurrency!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  responseDeadlineUtc!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  quotesDeadlineUtc!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  acceptedAtUtc!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  completedAtUtc!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  paidAtUtc!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  cancelledAtUtc!: Date | null;

  @Column({ type: 'text', nullable: true })
  cancellationReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  cancelledByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'cancelled_by_user_id' })
  cancelledByUser!: User | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
