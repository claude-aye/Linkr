import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ServiceRequestAttachmentKind } from '../enums/service-request-attachment-kind.enum';

/** Non-file fields of the multipart upload (the file comes via @UploadedFile). */
export class UploadServiceRequestAttachmentDto {
  @ApiProperty({ enum: ServiceRequestAttachmentKind })
  @IsEnum(ServiceRequestAttachmentKind)
  attachmentKind!: ServiceRequestAttachmentKind;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}
