import { ApiProperty } from '@nestjs/swagger';
import { ServiceRequestStatus } from '../../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../../service-requests/enums/service-request-type.enum';
import type { EventTiming } from '../event-timing';
import type { CalendarEventDetailRecord } from '../repositories/calendar-events.repository';

/** What an entry IS: a job the provider holds, or a booking still awaiting his answer. */
export enum CalendarEventKind {
  JOB = 'JOB',
  PENDING_REQUEST = 'PENDING_REQUEST',
}

/** How it sits on the calendar (see `resolveEventTiming`). */
export enum CalendarEventTiming {
  TIMED = 'TIMED',
  ALL_DAY = 'ALL_DAY',
  UNSCHEDULED = 'UNSCHEDULED',
}

/**
 * One appointment on the provider's OWN calendar.
 *
 * It carries the request's title, address and client name: the reader is the
 * assignee or the targeted provider, the same named counterparty the dashboard
 * already shows them to. It carries NO coordinates and no client account id
 * (Loi 25) — and it is never served to anyone but the provider himself.
 */
export class CalendarEventDto {
  @ApiProperty({ description: 'Id of the underlying service request' })
  id!: string;

  @ApiProperty({ enum: CalendarEventKind, enumName: 'CalendarEventKind' })
  kind!: CalendarEventKind;

  @ApiProperty({ enum: ServiceRequestStatus, enumName: 'ServiceRequestStatus' })
  status!: ServiceRequestStatus;

  @ApiProperty({ enum: ServiceRequestType, enumName: 'ServiceRequestType' })
  requestType!: ServiceRequestType;

  @ApiProperty({ enum: CalendarEventTiming, enumName: 'CalendarEventTiming' })
  timing!: CalendarEventTiming;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'TIMED only' })
  startAtUtc!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'TIMED only' })
  endAtUtc!: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'ALL_DAY only: the civil day, YYYY-MM-DD',
    example: '2026-11-20',
  })
  date!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'End of the window the client offered (direct booking), for information',
  })
  windowEndAtUtc!: Date | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Announced duration, when one is known (listed service or accepted quote)',
  })
  durationMinutes!: number | null;

  @ApiProperty() title!: string;
  @ApiProperty() serviceAddress!: string;

  @ApiProperty({ description: 'Display name of the client', example: 'Marie Tremblay' })
  clientDisplayName!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { 'fr-CA': 'Coiffure', 'en-CA': 'Hairdressing' },
  })
  serviceCategoryNameTranslations!: Record<string, string>;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    nullable: true,
  })
  serviceItemNameTranslations!: Record<string, string> | null;

  static from(record: CalendarEventDetailRecord, timing: EventTiming): CalendarEventDto {
    const direct = record.requestType === ServiceRequestType.DIRECT_BOOKING;
    const dto = new CalendarEventDto();
    dto.id = record.id;
    dto.kind =
      record.status === ServiceRequestStatus.OPEN
        ? CalendarEventKind.PENDING_REQUEST
        : CalendarEventKind.JOB;
    dto.status = record.status;
    dto.requestType = record.requestType;
    dto.timing = CalendarEventTiming[timing.kind];
    dto.startAtUtc = timing.kind === 'TIMED' ? new Date(timing.startMs) : null;
    dto.endAtUtc = timing.kind === 'TIMED' ? new Date(timing.endMs) : null;
    dto.date = timing.kind === 'ALL_DAY' ? timing.date : null;
    dto.windowEndAtUtc = direct ? record.desiredEndAtUtc : null;
    dto.durationMinutes = direct ? record.serviceDurationMinutes : record.quoteDurationMinutes;
    dto.title = record.title;
    dto.serviceAddress = record.serviceAddress;
    dto.clientDisplayName = record.clientDisplayName ?? '—';
    dto.serviceCategoryNameTranslations = record.categoryNameTranslations;
    dto.serviceItemNameTranslations = record.itemNameTranslations;
    return dto;
  }
}
