import { ApiProperty } from '@nestjs/swagger';

/**
 * The feed link, returned ONCE when it is generated. The token is not stored
 * (only its SHA-256 is), so it cannot be shown again: losing it means
 * generating a new one, which also revokes this one.
 */
export class CalendarFeedDto {
  @ApiProperty({ description: 'The secret token. Shown once.' })
  token!: string;

  @ApiProperty({
    description:
      'Feed path RELATIVE to the web origin (the API itself is not reachable from the Internet).',
    example: '/calendrier/flux/3q2-7wEhk0P…',
  })
  path!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAtUtc!: Date;
}
