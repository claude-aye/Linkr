import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectServiceItemDto {
  @ApiProperty({ example: 'Category already covered by an existing item.' })
  @IsString()
  @MinLength(1)
  rejectionReason!: string;
}
