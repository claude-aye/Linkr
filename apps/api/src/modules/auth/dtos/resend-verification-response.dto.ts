import { ApiProperty } from '@nestjs/swagger';

export const RESEND_VERIFICATION_STATUSES = ['SENT', 'ALREADY_VERIFIED'] as const;
export type ResendVerificationStatus = (typeof RESEND_VERIFICATION_STATUSES)[number];

export class ResendVerificationResponseDto {
  @ApiProperty({
    enum: RESEND_VERIFICATION_STATUSES,
    enumName: 'ResendVerificationStatus',
    description:
      'SENT: a new link was queued (older links stop working). ALREADY_VERIFIED: nothing was sent.',
  })
  status!: ResendVerificationStatus;
}
