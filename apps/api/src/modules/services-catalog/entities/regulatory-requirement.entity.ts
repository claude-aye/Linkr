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
import { InputType } from '../enums/input-type.enum';
import { RequiredDocumentType } from '../enums/required-document-type.enum';
import { ServiceCategory } from './service-category.entity';

@Entity({ name: 'regulatory_requirements' })
export class RegulatoryRequirement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceCategoryId!: string;

  @ManyToOne(() => ServiceCategory, (cat) => cat.requirements, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_category_id' })
  serviceCategory!: ServiceCategory;

  @Column({ type: 'varchar', length: 2 })
  countryCode!: string;

  @Column({ type: 'varchar', length: 6, nullable: true })
  subdivisionCode!: string | null;

  @Column({ type: 'varchar', length: 40 })
  authorityCode!: string;

  @Column({ type: 'jsonb' })
  authorityFullNameTranslations!: Record<string, string>;

  @Column({ type: 'varchar', nullable: true })
  validationEndpointUrl!: string | null;

  @Column({
    type: 'enum',
    enum: RequiredDocumentType,
    enumName: 'regulatory_required_document_type',
  })
  requiredDocumentType!: RequiredDocumentType;

  @Column({
    type: 'enum',
    enum: InputType,
    enumName: 'regulatory_input_type',
  })
  inputType!: InputType;

  @Column({ type: 'boolean', default: true })
  isRequired!: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
