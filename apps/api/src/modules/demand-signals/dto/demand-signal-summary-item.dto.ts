import { ApiProperty } from '@nestjs/swagger';
import type { DemandSignalSummaryRecord } from '../repositories/demand-signals.repository';

/**
 * One cell of the recruitment map: a trade, a coarse sector, and how many
 * searches came back empty there.
 *
 * ⚠️ THIS IS AN AGGREGATE, AND THE AGGREGATION IS THE PRIVACY PROPERTY — not a
 * convenience. Migration 1780510000000 made anonymity STRUCTURAL by carrying no
 * user reference at all; a read layer can undo that without touching the schema,
 * and it is the only real risk of this endpoint. `demand_signals.created_at_utc`
 * has microsecond precision (`16:54:01.099401`): served next to a trade, that is
 * a correlation key — cross-referenced with server logs or a known session it
 * re-attaches a row to the person the missing `user_id` protected. So no row id,
 * no exact coordinate and no clock time ever leaves the server; the finest
 * temporal grain in this DTO is THE DAY.
 *
 * ⚠️ Every property is annotated explicitly, with a concrete `type`. The Swagger
 * CLI plugin is not enabled in `nest-cli.json`, so an un-annotated property is
 * emitted EMPTY into `openapi.json`, and a map without `additionalProperties`
 * degrades to `Record<string, never>` in the generated client (the nullable/JSONB
 * debt of CLAUDE.md §6). The admin page must consume this natively — no
 * hand-written mirror, no cast.
 */
export class DemandSignalSummaryItemDto {
  @ApiProperty({ type: String, format: 'uuid' })
  serviceCategoryId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' }, // without this it degrades to Record<string, never>
    description: 'Trade name, i18n map (fr-CA / en-CA …).',
    example: { 'fr-CA': 'Esthétique', 'en-CA': 'Esthetics' },
  })
  serviceCategoryNameTranslations!: Record<string, string>;

  @ApiProperty({
    type: Number,
    description:
      'Sector latitude — a ~1.1 km cell, NOT the searched point. Stored as numeric(4,2), so it cannot be finer.',
    example: 48.45,
  })
  sectorLat!: number;

  @ApiProperty({
    type: Number,
    description:
      'Sector longitude — a ~0.76 km cell at Quebec latitude, NOT the searched point. Stored as numeric(5,2).',
    example: -68.53,
  })
  sectorLng!: number;

  @ApiProperty({
    type: Number,
    description: 'How many searches for this trade returned zero in this sector.',
    example: 12,
  })
  signalCount!: number;

  @ApiProperty({
    type: String,
    format: 'date',
    description:
      'Day of the oldest signal in this cell, UTC, truncated to the day. Never a clock time — see the class comment.',
    example: '2026-08-01',
  })
  firstSeenDate!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    description: 'Day of the most recent signal in this cell, UTC, truncated to the day.',
    example: '2026-08-19',
  })
  lastSeenDate!: string;

  static from(record: DemandSignalSummaryRecord): DemandSignalSummaryItemDto {
    const dto = new DemandSignalSummaryItemDto();
    dto.serviceCategoryId = record.serviceCategoryId;
    dto.serviceCategoryNameTranslations = record.serviceCategoryNameTranslations;
    dto.sectorLat = record.sectorLat;
    dto.sectorLng = record.sectorLng;
    dto.signalCount = record.signalCount;
    dto.firstSeenDate = record.firstSeenDate;
    dto.lastSeenDate = record.lastSeenDate;
    return dto;
  }
}
