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
import { ServiceRequestAttachmentKind } from '../enums/service-request-attachment-kind.enum';

@Entity({ name: 'service_request_attachments' })
export class ServiceRequestAttachment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceRequestId!: string;

  @ManyToOne(() => ServiceRequest, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_request_id' })
  serviceRequest!: ServiceRequest;

  @Column({
    type: 'enum',
    enum: ServiceRequestAttachmentKind,
    enumName: 'service_request_attachment_kind',
  })
  attachmentKind!: ServiceRequestAttachmentKind;

  // Storage key (relative local path / S3 object key) — never a public URL.
  @Column({ type: 'text' })
  fileUrl!: string;

  @Column({ type: 'varchar', length: 100 })
  fileMimeType!: string;

  @Column({ type: 'int' })
  fileSizeBytes!: number;

  @Column({ type: 'text', nullable: true })
  caption!: string | null;

  @Column({ type: 'uuid' })
  uploadedByUserId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'uploaded_by_user_id' })
  uploadedByUser!: User;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
