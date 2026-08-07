import { ApiProperty } from '@nestjs/swagger';
import { ServiceRequestStatus } from '../../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../../service-requests/enums/service-request-type.enum';
import { NotificationType } from '../enums/notification-type.enum';
import type { NotificationRecord } from '../repositories/notifications.repository';

/**
 * One notification as `GET /notifications` returns it: the row, plus the labels
 * joined from the service request it points at.
 *
 * ⚠️ EVERY property is annotated explicitly, `nullable` ones included, and that
 * is not decoration. The Swagger CLI plugin is not enabled in `nest-cli.json`,
 * so an un-annotated property is emitted EMPTY into `openapi.json`; and a
 * property annotated without a concrete `type` reflects `design:type = Object`
 * for a `T | null` union, which lands as `Record<string, never>` in the
 * generated client — the nullable debt tracked in CLAUDE.md §6. The front of
 * PR C must consume this DTO natively, with no hand-written mirror and no cast.
 *
 * ⚠️ NO LOCATION FIELD, deliberately. The plan asked for a city; there is none
 * to join — `service_requests` carries a single free-text `service_address`
 * (no city / locality column exists anywhere in the API), and parsing it would
 * be fabrication. Serving the full street address instead would be a NEW
 * exposure rather than the status quo: `GET /service-requests/:id` is
 * owner-or-ADMIN, and the provider dashboard only shows an address for requests
 * assigned to or targeted at that provider. A NEW_TENDER_MATCH recipient is
 * neither — it is a geographic match, so the full address of every client in
 * radius would be broadcast to every provider covering it. The recipient
 * already knows the job is in their coverage: that is the condition that earned
 * them the notification. A real `locality`, captured at geocoding time, is the
 * honest fix — tracked as debt in CLAUDE.md §6.
 */
export class NotificationItemDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: NotificationType, enumName: 'NotificationType' })
  type!: NotificationType;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the recipient read it. Null means unread.',
  })
  readAtUtc!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAtUtc!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true, // free-form JSONB — without this it degrades to Record<string, never>
    nullable: true,
    description:
      'Free-form payload. Identifiers are NOT duplicated here: the recipient and the service request are real columns, and this endpoint joins on them. Reserved for what cannot be joined — a rendering hint, a snapshot of a value that will legitimately drift from its source.',
    example: { serviceCategoryId: '0c44ccbd-…', title: 'Fuite sous l’évier' },
  })
  data!: Record<string, unknown> | null;

  // ── Joined from the service request (LEFT JOIN — all nullable) ─────────────

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The request this notification is about, if any.',
  })
  serviceRequestId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Request title. Null when the notification carries no request.',
  })
  serviceRequestTitle!: string | null;

  @ApiProperty({
    enum: ServiceRequestStatus,
    enumName: 'ServiceRequestStatus',
    nullable: true,
    description:
      'The request’s CURRENT status, not the one it had when notified — a cancelled or expired request reports what it really is.',
  })
  serviceRequestStatus!: ServiceRequestStatus | null;

  @ApiProperty({
    enum: ServiceRequestType,
    enumName: 'ServiceRequestType',
    nullable: true,
  })
  serviceRequestType!: ServiceRequestType | null;

  @ApiProperty({
    type: Boolean,
    description:
      'True when the request has been soft-deleted. The notification is kept and returned anyway — hiding it would leave the recipient with nothing, and this flag lets the reader say so instead of linking somewhere that 404s.',
  })
  serviceRequestDeleted!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' }, // types the JSONB map (codegen → Record<string, string>)
    nullable: true,
    description: 'i18n labels of the request’s trade (métier).',
    example: { 'fr-CA': 'Plomberie', 'en-CA': 'Plumbing' },
  })
  serviceCategoryNameTranslations!: Record<string, string> | null;

  /**
   * Built from a label-joined record. Defensive on the joined fields: a
   * notification whose request row is missing still yields a renderable item.
   */
  static from(record: NotificationRecord): NotificationItemDto {
    const dto = new NotificationItemDto();
    dto.id = record.id;
    dto.type = record.type;
    dto.readAtUtc = record.readAtUtc?.toISOString() ?? null;
    dto.createdAtUtc = record.createdAtUtc.toISOString();
    dto.data = record.data;
    dto.serviceRequestId = record.serviceRequestId;
    dto.serviceRequestTitle = record.serviceRequestTitle;
    dto.serviceRequestStatus = record.serviceRequestStatus;
    dto.serviceRequestType = record.serviceRequestType;
    dto.serviceRequestDeleted = record.serviceRequestDeleted;
    dto.serviceCategoryNameTranslations =
      record.serviceCategoryNameTranslations ?? null;
    return dto;
  }
}
