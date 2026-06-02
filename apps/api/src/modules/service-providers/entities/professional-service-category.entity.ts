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
import { PscVerificationStatus } from '../enums/psc-verification-status.enum';
import { ServiceProvider } from './service-provider.entity';

@Entity({ name: 'professional_service_categories' })
export class ProfessionalServiceCategory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceProviderId!: string;

  @ManyToOne(() => ServiceProvider, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_provider_id' })
  serviceProvider!: ServiceProvider;

  @Column({ type: 'uuid' })
  serviceCategoryId!: string;

  @Column({
    type: 'enum',
    enum: PscVerificationStatus,
    enumName: 'psc_verification_status',
  })
  verificationStatus!: PscVerificationStatus;

  @Column({ type: 'timestamp with time zone' })
  requestedAtUtc!: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  verifiedAtUtc!: Date | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
