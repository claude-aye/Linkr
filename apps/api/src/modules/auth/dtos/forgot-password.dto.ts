import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    description:
      'Address to send a reset link to. The response is identical whether or not an account exists for it.',
    example: 'carol@linkr.test',
  })
  @IsEmail()
  email!: string;
}
