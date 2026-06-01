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
import { ApprovalStatus } from '../enums/approval-status.enum';
import { ServiceCategory } from './service-category.entity';

export interface PriceRange {
  min: number;
  max: number;
  currency: string;
}

@Entity({ name: 'service_items' })
export class ServiceItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceCategoryId!: string;

  @ManyToOne(() => ServiceCategory, (cat) => cat.items, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_category_id' })
  serviceCategory!: ServiceCategory;

  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'jsonb' })
  nameTranslations!: Record<string, string>;

  @Column({ type: 'jsonb', default: '{}' })
  descriptionTranslations!: Record<string, string>;

  @Column({ type: 'int', nullable: true })
  typicalDurationMinutes!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  suggestedPriceRange!: PriceRange | null;

  @Column({ type: 'uuid', nullable: true })
  suggestedByUserId!: string | null;

  @Column({
    type: 'enum',
    enum: ApprovalStatus,
    enumName: 'service_item_approval_status',
    default: ApprovalStatus.PENDING,
  })
  approvalStatus!: ApprovalStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  approvedAtUtc!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  approvedByUserId!: string | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
