import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { RequiredDocumentType } from '../../services-catalog/enums/required-document-type.enum';

/** Non-file fields of the multipart upload (the file comes via @UploadedFile). */
export class UploadVerificationDocumentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  regulatoryRequirementId!: string;

  @ApiProperty({ enum: RequiredDocumentType })
  @IsEnum(RequiredDocumentType)
  documentType!: RequiredDocumentType;

  @ApiPropertyOptional({ maxLength: 120, example: 'RBQ-1234' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  documentNumber?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 date the authority issued the document' })
  @IsOptional()
  @IsISO8601()
  issuedAtUtc?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 expiry date (scanned by the expiry cron)' })
  @IsOptional()
  @IsISO8601()
  expiresAtUtc?: string;
}
