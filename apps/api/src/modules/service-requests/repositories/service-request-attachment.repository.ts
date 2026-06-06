import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ServiceRequestAttachment } from '../entities/service-request-attachment.entity';
import { ServiceRequestAttachmentKind } from '../enums/service-request-attachment-kind.enum';

export interface CreateAttachmentData {
  serviceRequestId: string;
  attachmentKind: ServiceRequestAttachmentKind;
  fileUrl: string;
  fileMimeType: string;
  fileSizeBytes: number;
  caption?: string | null;
  uploadedByUserId: string;
}

@Injectable()
export class ServiceRequestAttachmentRepository {
  constructor(
    @InjectRepository(ServiceRequestAttachment)
    private readonly repo: Repository<ServiceRequestAttachment>,
  ) {}

  findById(id: string): Promise<ServiceRequestAttachment | null> {
    return this.repo.findOne({ where: { id, deletedAtUtc: IsNull() } });
  }

  findByRequestId(
    serviceRequestId: string,
  ): Promise<ServiceRequestAttachment[]> {
    return this.repo.find({
      where: { serviceRequestId, deletedAtUtc: IsNull() },
      order: { createdAtUtc: 'ASC' },
    });
  }

  async create(
    data: CreateAttachmentData,
  ): Promise<ServiceRequestAttachment> {
    const attachment = this.repo.create({
      serviceRequestId: data.serviceRequestId,
      attachmentKind: data.attachmentKind,
      fileUrl: data.fileUrl,
      fileMimeType: data.fileMimeType,
      fileSizeBytes: data.fileSizeBytes,
      caption: data.caption ?? null,
      uploadedByUserId: data.uploadedByUserId,
    });
    return this.repo.save(attachment);
  }

  /** Soft delete — sets deleted_at_utc, never removes the row or the blob. */
  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }
}
