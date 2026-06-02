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
import { RequiredDocumentType } from '../../services-catalog/enums/required-document-type.enum';
import { ProfessionalServiceCategory } from '../../service-providers/entities/professional-service-category.entity';
import { RegulatoryRequirement } from '../../services-catalog/entities/regulatory-requirement.entity';
import { VerificationDocumentReviewStatus } from '../enums/verification-document-review-status.enum';

@Entity({ name: 'verification_documents' })
export class VerificationDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  professionalServiceCategoryId!: string;

  @ManyToOne(() => ProfessionalServiceCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'professional_service_category_id' })
  professionalServiceCategory!: ProfessionalServiceCategory;

  @Column({ type: 'uuid' })
  regulatoryRequirementId!: string;

  @ManyToOne(() => RegulatoryRequirement, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'regulatory_requirement_id' })
  regulatoryRequirement!: RegulatoryRequirement;

  // Reuses the regulatory_required_document_type enum (no parallel enum).
  @Column({
    type: 'enum',
    enum: RequiredDocumentType,
    enumName: 'regulatory_required_document_type',
  })
  documentType!: RequiredDocumentType;

  @Column({ type: 'varchar', length: 120, nullable: true })
  documentNumber!: string | null;

  // Storage key (relative local path / S3 object key) — never a public URL.
  @Column({ type: 'text' })
  fileUrl!: string;

  @Column({ type: 'varchar', length: 100 })
  fileMimeType!: string;

  @Column({ type: 'int' })
  fileSizeBytes!: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  issuedAtUtc!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  expiresAtUtc!: Date | null;

  @Column({
    type: 'enum',
    enum: VerificationDocumentReviewStatus,
    enumName: 'verification_document_review_status',
    default: VerificationDocumentReviewStatus.PENDING,
  })
  reviewStatus!: VerificationDocumentReviewStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  reviewedAtUtc!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedByUserId!: string | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason!: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
