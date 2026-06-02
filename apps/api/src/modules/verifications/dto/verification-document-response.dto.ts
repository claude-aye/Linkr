import { ApiProperty } from '@nestjs/swagger';
import { RequiredDocumentType } from '../../services-catalog/enums/required-document-type.enum';
import { VerificationDocument } from '../entities/verification-document.entity';
import { VerificationDocumentReviewStatus } from '../enums/verification-document-review-status.enum';

/** Response DTO — exposes a download link rather than the raw storage key. */
export class VerificationDocumentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() professionalServiceCategoryId!: string;
  @ApiProperty() regulatoryRequirementId!: string;
  @ApiProperty({ enum: RequiredDocumentType }) documentType!: RequiredDocumentType;
  @ApiProperty({ nullable: true }) documentNumber!: string | null;
  @ApiProperty({ description: 'Relative download endpoint for the stored file' })
  downloadUrl!: string;
  @ApiProperty() fileMimeType!: string;
  @ApiProperty() fileSizeBytes!: number;
  @ApiProperty({ nullable: true }) issuedAtUtc!: Date | null;
  @ApiProperty({ nullable: true }) expiresAtUtc!: Date | null;
  @ApiProperty({ enum: VerificationDocumentReviewStatus })
  reviewStatus!: VerificationDocumentReviewStatus;
  @ApiProperty({ nullable: true }) reviewedAtUtc!: Date | null;
  @ApiProperty({ nullable: true }) rejectionReason!: string | null;
  @ApiProperty() createdAtUtc!: Date;
  @ApiProperty() updatedAtUtc!: Date;

  static from(doc: VerificationDocument): VerificationDocumentResponseDto {
    const dto = new VerificationDocumentResponseDto();
    dto.id = doc.id;
    dto.professionalServiceCategoryId = doc.professionalServiceCategoryId;
    dto.regulatoryRequirementId = doc.regulatoryRequirementId;
    dto.documentType = doc.documentType;
    dto.documentNumber = doc.documentNumber;
    dto.downloadUrl = `/verification-documents/${doc.id}/file`;
    dto.fileMimeType = doc.fileMimeType;
    dto.fileSizeBytes = doc.fileSizeBytes;
    dto.issuedAtUtc = doc.issuedAtUtc;
    dto.expiresAtUtc = doc.expiresAtUtc;
    dto.reviewStatus = doc.reviewStatus;
    dto.reviewedAtUtc = doc.reviewedAtUtc;
    dto.rejectionReason = doc.rejectionReason;
    dto.createdAtUtc = doc.createdAtUtc;
    dto.updatedAtUtc = doc.updatedAtUtc;
    return dto;
  }
}
