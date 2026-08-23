import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * ⚠️ THE PASSWORD RULES ARE A DELIBERATE MIRROR OF `SignupDto`, not a fresh
 * opinion. A reset that accepted a password signup would have refused (or vice
 * versa) is a rule that exists in two places and will drift. If the signup rules
 * change, change them here in the same commit.
 */
export class ResetPasswordDto {
  @ApiProperty({
    description:
      'The raw token from the emailed link. Only its SHA-256 is stored server-side.',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({
    description: 'The new password. Same constraints as signup.',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
