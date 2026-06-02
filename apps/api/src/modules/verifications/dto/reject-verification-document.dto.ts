import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RejectVerificationDocumentDto {
  @ApiProperty({ description: 'Reason shown to the provider for the rejection' })
  @IsString()
  @IsNotEmpty()
  rejectionReason!: string;
}
