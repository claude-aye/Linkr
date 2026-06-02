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
import { PricingModel } from '../enums/pricing-model.enum';
import { ProfessionalServiceCategory } from './professional-service-category.entity';

@Entity({ name: 'professional_services' })
export class ProfessionalService {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  professionalServiceCategoryId!: string;

  @ManyToOne(() => ProfessionalServiceCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'professional_service_category_id' })
  professionalServiceCategory!: ProfessionalServiceCategory;

  @Column({ type: 'uuid' })
  serviceItemId!: string;

  @Column({
    type: 'enum',
    enum: PricingModel,
    enumName: 'professional_service_pricing_model',
  })
  pricingModel!: PricingModel;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  priceAmount!: string | null;

  @Column({ type: 'varchar', length: 3 })
  priceCurrency!: string;

  @Column({ type: 'int', nullable: true })
  estimatedDurationMinutes!: number | null;

  @Column({ type: 'text', nullable: true })
  descriptionOverride!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
