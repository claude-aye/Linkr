import {
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
import { User } from '../../users/entities/user.entity';
import { ServiceRequest } from './service-request.entity';
import { ServiceRequestAssignmentStatus } from '../enums/service-request-assignment-status.enum';

/**
 * MIRROR OF `uq_sra_one_live_per_request`, created by
 * `1780400000000-CreateServiceRequestAssignments`. It is not decoration: the
 * partial unique index is what makes "at most one live assignment per request"
 * a fact of the schema rather than a hope of the service layer, and without
 * this decorator `migration:generate` proposes to DROP it (measured, not
 * assumed — a probe migration generated on a fully-migrated database emitted
 * `DROP INDEX "public"."uq_sra_one_live_per_request"` in its `up()`).
 *
 * The predicate must stay CHARACTER-FOR-CHARACTER the predicate of
 * `ServiceRequestAssignmentRepository.findLiveByRequestId`. If the two drift,
 * the database's idea of a live assignment and the application's stop being the
 * same idea, and the index silently guards something nobody queries.
 */
@Index('uq_sra_one_live_per_request', ['serviceRequestId'], {
  unique: true,
  where: `deleted_at_utc IS NULL AND status <> 'DECLINED_BY_WORKER'`,
})
@Entity({ name: 'service_request_assignments' })
export class ServiceRequestAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceRequestId!: string;

  @ManyToOne(() => ServiceRequest, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_request_id' })
  serviceRequest!: ServiceRequest;

  @Column({ type: 'uuid' })
  workerUserId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'worker_user_id' })
  workerUser!: User;

  @Column({ type: 'uuid' })
  assignedByUserId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assigned_by_user_id' })
  assignedByUser!: User;

  @Column({
    type: 'enum',
    enum: ServiceRequestAssignmentStatus,
    enumName: 'service_request_assignment_status',
  })
  status!: ServiceRequestAssignmentStatus;

  @Column({ type: 'timestamp with time zone' })
  assignedAtUtc!: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  acknowledgedAtUtc!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  declinedAtUtc!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  completedAtUtc!: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
