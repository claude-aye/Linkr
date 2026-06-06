import { ApiProperty } from '@nestjs/swagger';
import { ServiceRequestAttachment } from '../entities/service-request-attachment.entity';
import { ServiceRequestAttachmentKind } from '../enums/service-request-attachment-kind.enum';

export class ServiceRequestAttachmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() serviceRequestId!: string;
  @ApiProperty({ enum: ServiceRequestAttachmentKind })
  attachmentKind!: ServiceRequestAttachmentKind;
  @ApiProperty({ description: 'Relative storage key for the stored file' })
  fileUrl!: string;
  @ApiProperty() fileMimeType!: string;
  @ApiProperty() fileSizeBytes!: number;
  @ApiProperty({ nullable: true }) caption!: string | null;
  @ApiProperty() uploadedByUserId!: string;
  @ApiProperty() createdAtUtc!: Date;

  static from(
    attachment: ServiceRequestAttachment,
  ): ServiceRequestAttachmentResponseDto {
    const dto = new ServiceRequestAttachmentResponseDto();
    dto.id = attachment.id;
    dto.serviceRequestId = attachment.serviceRequestId;
    dto.attachmentKind = attachment.attachmentKind;
    dto.fileUrl = attachment.fileUrl;
    dto.fileMimeType = attachment.fileMimeType;
    dto.fileSizeBytes = attachment.fileSizeBytes;
    dto.caption = attachment.caption;
    dto.uploadedByUserId = attachment.uploadedByUserId;
    dto.createdAtUtc = attachment.createdAtUtc;
    return dto;
  }
}
