import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { GeoJSONPoint } from '../../../common/geojson/geojson.types';
import { ServiceRequest } from '../entities/service-request.entity';
import { ServiceRequestStatus } from '../enums/service-request-status.enum';
import { ServiceRequestType } from '../enums/service-request-type.enum';

export interface ServiceRequestRecord {
  id: string;
  clientUserId: string;
  requestType: ServiceRequestType;
  status: ServiceRequestStatus;
  serviceCategoryId: string;
  serviceItemId: string | null;
  requestedServiceProviderId: string | null;
  assignedServiceProviderId: string | null;
  title: string;
  description: string;
  serviceAddress: string;
  serviceLocation: GeoJSONPoint;
  desiredStartAtUtc: Date | null;
  desiredEndAtUtc: Date | null;
  scheduledAtUtc: Date | null;
  estimatedAmount: string | null;
  estimatedCurrency: string | null;
  finalAmount: string | null;
  finalCurrency: string | null;
  responseDeadlineUtc: Date | null;
  quotesDeadlineUtc: Date | null;
  acceptedAtUtc: Date | null;
  completedAtUtc: Date | null;
  paidAtUtc: Date | null;
  contestedAtUtc: Date | null;
  cancelledAtUtc: Date | null;
  cancellationReason: string | null;
  cancelledByUserId: string | null;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

/**
 * Label-joined projection for the provider dashboard listing
 * ({@link ServiceRequestRepository.findAssignedOrTargetedToProvider}). Carries
 * the subset of request columns the `ProviderServiceRequestItemDto` exposes —
 * deliberately NO geo (`service_location` is never selected) — plus the joined
 * i18n trade / service names and the client's name parts.
 */
export interface ProviderServiceRequestRecord {
  id: string;
  status: ServiceRequestStatus;
  requestType: ServiceRequestType;
  title: string;
  description: string;
  serviceAddress: string;
  estimatedAmount: string | null;
  estimatedCurrency: string | null;
  finalAmount: string | null;
  finalCurrency: string | null;
  scheduledAtUtc: Date | null;
  desiredStartAtUtc: Date | null;
  desiredEndAtUtc: Date | null;
  acceptedAtUtc: Date | null;
  completedAtUtc: Date | null;
  paidAtUtc: Date | null;
  responseDeadlineUtc: Date | null;
  createdAtUtc: Date;
  updatedAtUtc: Date;
  assignedServiceProviderId: string | null;
  requestedServiceProviderId: string | null;
  serviceCategoryId: string;
  serviceItemId: string | null;
  // Joined labels
  serviceCategoryNameTranslations: Record<string, string>;
  serviceItemNameTranslations: Record<string, string> | null;
  clientDisplayName: string | null;
  clientFirstName: string | null;
  clientLastName: string | null;
}

export interface CreateServiceRequestData {
  clientUserId: string;
  requestType: ServiceRequestType;
  status: ServiceRequestStatus;
  serviceCategoryId: string;
  serviceItemId?: string | null;
  requestedServiceProviderId?: string | null;
  title: string;
  description: string;
  serviceAddress: string;
  serviceLocation: GeoJSONPoint;
  desiredStartAtUtc?: Date | null;
  desiredEndAtUtc?: Date | null;
  estimatedAmount?: string | null;
  estimatedCurrency?: string | null;
  responseDeadlineUtc?: Date | null;
  quotesDeadlineUtc?: Date | null;
}

export interface UpdateServiceRequestData {
  status?: ServiceRequestStatus;
  assignedServiceProviderId?: string | null;
  scheduledAtUtc?: Date | null;
  finalAmount?: string | null;
  finalCurrency?: string | null;
  acceptedAtUtc?: Date | null;
  completedAtUtc?: Date | null;
  paidAtUtc?: Date | null;
  cancelledAtUtc?: Date | null;
  cancellationReason?: string | null;
  cancelledByUserId?: string | null;
}

interface RawRow {
  id: string;
  client_user_id: string;
  request_type: ServiceRequestType;
  status: ServiceRequestStatus;
  service_category_id: string;
  service_item_id: string | null;
  requested_service_provider_id: string | null;
  assigned_service_provider_id: string | null;
  title: string;
  description: string;
  service_address: string;
  service_location: GeoJSONPoint;
  desired_start_at_utc: Date | null;
  desired_end_at_utc: Date | null;
  scheduled_at_utc: Date | null;
  estimated_amount: string | null;
  estimated_currency: string | null;
  final_amount: string | null;
  final_currency: string | null;
  response_deadline_utc: Date | null;
  quotes_deadline_utc: Date | null;
  accepted_at_utc: Date | null;
  completed_at_utc: Date | null;
  paid_at_utc: Date | null;
  contested_at_utc: Date | null;
  cancelled_at_utc: Date | null;
  cancellation_reason: string | null;
  cancelled_by_user_id: string | null;
  created_at_utc: Date;
  updated_at_utc: Date;
}

const SELECT_COLUMNS = `
  id, client_user_id, request_type, status,
  service_category_id, service_item_id,
  requested_service_provider_id, assigned_service_provider_id,
  title, description, service_address,
  ST_AsGeoJSON(service_location)::json AS service_location,
  desired_start_at_utc, desired_end_at_utc, scheduled_at_utc,
  estimated_amount, estimated_currency, final_amount, final_currency,
  response_deadline_utc, quotes_deadline_utc,
  accepted_at_utc, completed_at_utc, paid_at_utc, contested_at_utc,
  cancelled_at_utc, cancellation_reason, cancelled_by_user_id,
  created_at_utc, updated_at_utc
`;

function mapRow(row: RawRow): ServiceRequestRecord {
  return {
    id: row.id,
    clientUserId: row.client_user_id,
    requestType: row.request_type,
    status: row.status,
    serviceCategoryId: row.service_category_id,
    serviceItemId: row.service_item_id,
    requestedServiceProviderId: row.requested_service_provider_id,
    assignedServiceProviderId: row.assigned_service_provider_id,
    title: row.title,
    description: row.description,
    serviceAddress: row.service_address,
    serviceLocation: row.service_location,
    desiredStartAtUtc: row.desired_start_at_utc,
    desiredEndAtUtc: row.desired_end_at_utc,
    scheduledAtUtc: row.scheduled_at_utc,
    estimatedAmount: row.estimated_amount,
    estimatedCurrency: row.estimated_currency,
    finalAmount: row.final_amount,
    finalCurrency: row.final_currency,
    responseDeadlineUtc: row.response_deadline_utc,
    quotesDeadlineUtc: row.quotes_deadline_utc,
    acceptedAtUtc: row.accepted_at_utc,
    completedAtUtc: row.completed_at_utc,
    paidAtUtc: row.paid_at_utc,
    contestedAtUtc: row.contested_at_utc,
    cancelledAtUtc: row.cancelled_at_utc,
    cancellationReason: row.cancellation_reason,
    cancelledByUserId: row.cancelled_by_user_id,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

/**
 * Columns for the provider-dashboard read, aliased on `sr` and joined to the
 * catalog + client for the labels.
 *
 * CRITICAL (geo-safe): no geometry column is selected — neither
 * `sr.service_location` nor `users.default_location` (the latter is NOT
 * `select:false` on the User entity, so a relations-load would have read raw
 * WKB). The Loi-25-excluded GPS therefore never leaves the DB on this path.
 */
const PROVIDER_SELECT_COLUMNS = `
  sr.id, sr.status, sr.request_type,
  sr.title, sr.description, sr.service_address,
  sr.estimated_amount, sr.estimated_currency, sr.final_amount, sr.final_currency,
  sr.scheduled_at_utc, sr.desired_start_at_utc, sr.desired_end_at_utc,
  sr.accepted_at_utc, sr.completed_at_utc, sr.paid_at_utc, sr.response_deadline_utc,
  sr.created_at_utc, sr.updated_at_utc,
  sr.assigned_service_provider_id, sr.requested_service_provider_id,
  sr.service_category_id, sr.service_item_id,
  sc.name_translations AS service_category_name_translations,
  si.name_translations AS service_item_name_translations,
  cu.display_name AS client_display_name,
  cu.first_name  AS client_first_name,
  cu.last_name   AS client_last_name
`;

interface ProviderRawRow {
  id: string;
  status: ServiceRequestStatus;
  request_type: ServiceRequestType;
  title: string;
  description: string;
  service_address: string;
  estimated_amount: string | null;
  estimated_currency: string | null;
  final_amount: string | null;
  final_currency: string | null;
  scheduled_at_utc: Date | null;
  desired_start_at_utc: Date | null;
  desired_end_at_utc: Date | null;
  accepted_at_utc: Date | null;
  completed_at_utc: Date | null;
  paid_at_utc: Date | null;
  response_deadline_utc: Date | null;
  created_at_utc: Date;
  updated_at_utc: Date;
  assigned_service_provider_id: string | null;
  requested_service_provider_id: string | null;
  service_category_id: string;
  service_item_id: string | null;
  service_category_name_translations: Record<string, string>;
  service_item_name_translations: Record<string, string> | null;
  client_display_name: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
}

function mapProviderRow(row: ProviderRawRow): ProviderServiceRequestRecord {
  return {
    id: row.id,
    status: row.status,
    requestType: row.request_type,
    title: row.title,
    description: row.description,
    serviceAddress: row.service_address,
    estimatedAmount: row.estimated_amount,
    estimatedCurrency: row.estimated_currency,
    finalAmount: row.final_amount,
    finalCurrency: row.final_currency,
    scheduledAtUtc: row.scheduled_at_utc,
    desiredStartAtUtc: row.desired_start_at_utc,
    desiredEndAtUtc: row.desired_end_at_utc,
    acceptedAtUtc: row.accepted_at_utc,
    completedAtUtc: row.completed_at_utc,
    paidAtUtc: row.paid_at_utc,
    responseDeadlineUtc: row.response_deadline_utc,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    assignedServiceProviderId: row.assigned_service_provider_id,
    requestedServiceProviderId: row.requested_service_provider_id,
    serviceCategoryId: row.service_category_id,
    serviceItemId: row.service_item_id,
    serviceCategoryNameTranslations: row.service_category_name_translations,
    serviceItemNameTranslations: row.service_item_name_translations,
    clientDisplayName: row.client_display_name,
    clientFirstName: row.client_first_name,
    clientLastName: row.client_last_name,
  };
}

@Injectable()
export class ServiceRequestRepository {
  constructor(
    @InjectRepository(ServiceRequest)
    private readonly repo: Repository<ServiceRequest>,
  ) {}

  async findById(id: string): Promise<ServiceRequestRecord | null> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM service_requests
       WHERE id = $1 AND deleted_at_utc IS NULL`,
      [id],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  /**
   * Locked read (SELECT ... FOR UPDATE) within a transaction. Used by
   * cross-domain flows (e.g. quote acceptance) that must serialize against
   * concurrent state changes on the same request. FOR UPDATE is valid here —
   * the only computed column is a scalar ST_AsGeoJSON over service_location.
   */
  async findByIdForUpdate(
    id: string,
    manager: EntityManager,
  ): Promise<ServiceRequestRecord | null> {
    const rows: RawRow[] = await manager.query(
      `SELECT ${SELECT_COLUMNS} FROM service_requests
       WHERE id = $1 AND deleted_at_utc IS NULL
       FOR UPDATE`,
      [id],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findAll(opts: {
    clientUserId?: string;
    status?: ServiceRequestStatus;
    requestType?: ServiceRequestType;
    page: number;
    limit: number;
  }): Promise<{ items: ServiceRequestRecord[]; total: number }> {
    const conditions: string[] = ['deleted_at_utc IS NULL'];
    const params: unknown[] = [];
    let i = 1;

    if (opts.clientUserId) {
      conditions.push(`client_user_id = $${i++}`);
      params.push(opts.clientUserId);
    }
    if (opts.status) {
      conditions.push(`status = $${i++}`);
      params.push(opts.status);
    }
    if (opts.requestType) {
      conditions.push(`request_type = $${i++}`);
      params.push(opts.requestType);
    }

    const where = conditions.join(' AND ');
    const offset = (opts.page - 1) * opts.limit;

    const countRows: Array<{ count: string }> = await this.repo.query(
      `SELECT COUNT(*) AS count FROM service_requests WHERE ${where}`,
      params,
    );

    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM service_requests
       WHERE ${where}
       ORDER BY created_at_utc DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, opts.limit, offset],
    );

    return {
      items: rows.map(mapRow),
      total: parseInt(countRows[0].count, 10),
    };
  }

  /**
   * Provider-dashboard listing (Vision B): requests either ASSIGNED to the
   * provider, OR DIRECT_BOOKINGs still OPEN and targeted at it (awaiting the
   * provider's accept/decline). Joined to the trade / service / client for the
   * labelled DTO. Dedicated path — `findAll` stays untouched.
   *
   * `$1` (providerId) is referenced twice in the Vision B predicate; an optional
   * `status` narrows BOTH branches (e.g. status=ASSIGNED naturally drops the
   * targeted-OPEN branch). Geo-safe via PROVIDER_SELECT_COLUMNS (no geometry).
   */
  async findAssignedOrTargetedToProvider(
    providerId: string,
    opts: {
      status?: ServiceRequestStatus;
      page: number;
      limit: number;
    },
  ): Promise<{ items: ProviderServiceRequestRecord[]; total: number }> {
    const conditions: string[] = [
      'sr.deleted_at_utc IS NULL',
      `(sr.assigned_service_provider_id = $1
         OR (sr.requested_service_provider_id = $1 AND sr.status = 'OPEN'))`,
    ];
    const params: unknown[] = [providerId];
    let i = 2;

    if (opts.status) {
      conditions.push(`sr.status = $${i++}`);
      params.push(opts.status);
    }

    const where = conditions.join(' AND ');
    const offset = (opts.page - 1) * opts.limit;

    const countRows: Array<{ count: string }> = await this.repo.query(
      `SELECT COUNT(*) AS count FROM service_requests sr WHERE ${where}`,
      params,
    );

    const rows: ProviderRawRow[] = await this.repo.query(
      `SELECT ${PROVIDER_SELECT_COLUMNS}
         FROM service_requests sr
         JOIN service_categories sc ON sc.id = sr.service_category_id
         LEFT JOIN service_items si ON si.id = sr.service_item_id
         JOIN users cu ON cu.id = sr.client_user_id
        WHERE ${where}
        ORDER BY sr.created_at_utc DESC
        LIMIT $${i++} OFFSET $${i++}`,
      [...params, opts.limit, offset],
    );

    return {
      items: rows.map(mapProviderRow),
      total: parseInt(countRows[0].count, 10),
    };
  }

  async create(data: CreateServiceRequestData): Promise<ServiceRequestRecord> {
    const rows: Array<{ id: string }> = await this.repo.query(
      `INSERT INTO service_requests (
         client_user_id, request_type, status,
         service_category_id, service_item_id,
         requested_service_provider_id,
         title, description, service_address,
         service_location,
         desired_start_at_utc, desired_end_at_utc,
         estimated_amount, estimated_currency,
         response_deadline_utc, quotes_deadline_utc
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         ST_SetSRID(ST_GeomFromGeoJSON($10), 4326)::geometry,
         $11, $12, $13, $14, $15, $16
       ) RETURNING id`,
      [
        data.clientUserId,
        data.requestType,
        data.status,
        data.serviceCategoryId,
        data.serviceItemId ?? null,
        data.requestedServiceProviderId ?? null,
        data.title,
        data.description,
        data.serviceAddress,
        JSON.stringify(data.serviceLocation),
        data.desiredStartAtUtc ?? null,
        data.desiredEndAtUtc ?? null,
        data.estimatedAmount ?? null,
        data.estimatedCurrency ?? null,
        data.responseDeadlineUtc ?? null,
        data.quotesDeadlineUtc ?? null,
      ],
    );

    const created = await this.findById(rows[0].id);
    if (!created) throw new Error('Service request insert succeeded but read-back failed');
    return created;
  }

  async update(
    id: string,
    data: UpdateServiceRequestData,
    manager?: EntityManager,
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const add = (col: string, val: unknown): void => {
      sets.push(`${col} = $${i++}`);
      params.push(val);
    };

    if (data.status !== undefined) add('status', data.status);
    if (data.assignedServiceProviderId !== undefined)
      add('assigned_service_provider_id', data.assignedServiceProviderId);
    if (data.scheduledAtUtc !== undefined) add('scheduled_at_utc', data.scheduledAtUtc);
    if (data.finalAmount !== undefined) add('final_amount', data.finalAmount);
    if (data.finalCurrency !== undefined) add('final_currency', data.finalCurrency);
    if (data.acceptedAtUtc !== undefined) add('accepted_at_utc', data.acceptedAtUtc);
    if (data.completedAtUtc !== undefined) add('completed_at_utc', data.completedAtUtc);
    if (data.paidAtUtc !== undefined) add('paid_at_utc', data.paidAtUtc);
    if (data.cancelledAtUtc !== undefined) add('cancelled_at_utc', data.cancelledAtUtc);
    if (data.cancellationReason !== undefined) add('cancellation_reason', data.cancellationReason);
    if (data.cancelledByUserId !== undefined) add('cancelled_by_user_id', data.cancelledByUserId);

    if (sets.length === 0) return;
    sets.push(`updated_at_utc = now()`);
    params.push(id);

    const sql = `UPDATE service_requests SET ${sets.join(', ')} WHERE id = $${i} AND deleted_at_utc IS NULL`;

    if (manager) {
      await manager.query(sql, params);
    } else {
      await this.repo.query(sql, params);
    }
  }

  /** Find all OPEN requests whose applicable deadline has passed. */
  async findExpiredOpen(manager?: EntityManager): Promise<ServiceRequestRecord[]> {
    const sql = `
      SELECT ${SELECT_COLUMNS} FROM service_requests
      WHERE status = 'OPEN'
        AND deleted_at_utc IS NULL
        AND (
          (request_type = 'DIRECT_BOOKING' AND response_deadline_utc IS NOT NULL AND response_deadline_utc < NOW())
          OR
          (request_type = 'PROJECT_TENDER' AND quotes_deadline_utc IS NOT NULL AND quotes_deadline_utc < NOW())
        )
    `;
    const rows: RawRow[] = manager
      ? await manager.query(sql)
      : await this.repo.query(sql);
    return rows.map(mapRow);
  }

  /** Stamp contested_at_utc (idempotent: only the first, non-contested write wins). */
  async setContestedAt(id: string, when: Date): Promise<void> {
    await this.repo.query(
      `UPDATE service_requests
         SET contested_at_utc = $2, updated_at_utc = now()
       WHERE id = $1 AND deleted_at_utc IS NULL AND contested_at_utc IS NULL`,
      [id, when],
    );
  }

  /**
   * COMPLETED, non-contested requests whose release window elapsed — the
   * balance auto-release cron (Part 4) selects these. `make_interval` keeps the
   * hours threshold a bound parameter.
   */
  async findAwaitingRelease(autoReleaseHours: number): Promise<ServiceRequestRecord[]> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM service_requests
       WHERE status = 'COMPLETED'
         AND contested_at_utc IS NULL
         AND deleted_at_utc IS NULL
         AND completed_at_utc IS NOT NULL
         AND completed_at_utc < now() - make_interval(hours => $1)`,
      [autoReleaseHours],
    );
    return rows.map(mapRow);
  }

  /**
   * The accepted quote's amount/currency for a PROJECT_TENDER — the balance
   * basis for tenders (mirrors the deposit basis in 3.9). Exactly one quote is
   * ACCEPTED per request (siblings are auto-rejected on acceptance).
   */
  async findAcceptedQuoteAmount(
    serviceRequestId: string,
  ): Promise<{ amount: string; currency: string } | null> {
    const rows: Array<{ amount: string; currency: string }> = await this.repo.query(
      `SELECT amount, currency FROM quotes
       WHERE service_request_id = $1 AND status = 'ACCEPTED'
       LIMIT 1`,
      [serviceRequestId],
    );
    return rows.length ? { amount: rows[0].amount, currency: rows[0].currency } : null;
  }
}
