import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelServiceRequestDto {
  @ApiProperty({ description: 'Reason for cancellation.' })
  @IsString()
  @IsNotEmpty()
  cancellationReason!: string;
}
