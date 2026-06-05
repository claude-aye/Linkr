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
import { ServiceRequest } from './service-request.entity';
import { ServiceRequestAssignmentStatus } from '../enums/service-request-assignment-status.enum';

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
