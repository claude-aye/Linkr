import { ApiProperty } from '@nestjs/swagger';

/**
 * Response of `PATCH /notifications/:id/read`.
 *
 * Deliberately minimal — the id and the timestamp that was stamped. The caller
 * already holds the item it just marked, and the labelled projection belongs to
 * the listing; re-joining it here would duplicate that query for no reader.
 *
 * Because the write is idempotent, `readAtUtc` on a repeat call is the FIRST
 * read's timestamp, not the current time.
 */
export class NotificationReadResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'When it was first read. Never null in this response.',
  })
  readAtUtc!: string;
}
