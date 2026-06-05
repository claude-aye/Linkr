import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ServiceRequestAssignment } from '../entities/service-request-assignment.entity';
import { ServiceRequestAssignmentStatus } from '../enums/service-request-assignment-status.enum';

export interface ServiceRequestAssignmentRecord {
  id: string;
  serviceRequestId: string;
  workerUserId: string;
  assignedByUserId: string;
  status: ServiceRequestAssignmentStatus;
  assignedAtUtc: Date;
  acknowledgedAtUtc: Date | null;
  declinedAtUtc: Date | null;
  completedAtUtc: Date | null;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

export interface CreateAssignmentData {
  serviceRequestId: string;
  workerUserId: string;
  assignedByUserId: string;
  status: ServiceRequestAssignmentStatus;
  assignedAtUtc: Date;
}

export interface UpdateAssignmentData {
  status?: ServiceRequestAssignmentStatus;
  acknowledgedAtUtc?: Date;
  declinedAtUtc?: Date;
  completedAtUtc?: Date;
}

interface RawAssignmentRow {
  id: string;
  service_request_id: string;
  worker_user_id: string;
  assigned_by_user_id: string;
  status: ServiceRequestAssignmentStatus;
  assigned_at_utc: Date;
  acknowledged_at_utc: Date | null;
  declined_at_utc: Date | null;
  completed_at_utc: Date | null;
  created_at_utc: Date;
  updated_at_utc: Date;
}

const SELECT_COLUMNS = `
  id, service_request_id, worker_user_id, assigned_by_user_id,
  status, assigned_at_utc, acknowledged_at_utc, declined_at_utc,
  completed_at_utc, created_at_utc, updated_at_utc
`;

function mapRow(row: RawAssignmentRow): ServiceRequestAssignmentRecord {
  return {
    id: row.id,
    serviceRequestId: row.service_request_id,
    workerUserId: row.worker_user_id,
    assignedByUserId: row.assigned_by_user_id,
    status: row.status,
    assignedAtUtc: row.assigned_at_utc,
    acknowledgedAtUtc: row.acknowledged_at_utc,
    declinedAtUtc: row.declined_at_utc,
    completedAtUtc: row.completed_at_utc,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

@Injectable()
export class ServiceRequestAssignmentRepository {
  constructor(
    @InjectRepository(ServiceRequestAssignment)
    private readonly repo: Repository<ServiceRequestAssignment>,
  ) {}

  /** Find the live (non-soft-deleted, non-declined) assignment for a request. */
  async findLiveByRequestId(
    requestId: string,
    manager?: EntityManager,
  ): Promise<ServiceRequestAssignmentRecord | null> {
    const sql = `
      SELECT ${SELECT_COLUMNS} FROM service_request_assignments
      WHERE service_request_id = $1
        AND deleted_at_utc IS NULL
        AND status <> 'DECLINED_BY_WORKER'
      LIMIT 1
    `;
    const rows: RawAssignmentRow[] = manager
      ? await manager.query(sql, [requestId])
      : await this.repo.query(sql, [requestId]);
    return rows.length ? mapRow(rows[0]) : null;
  }

  async create(
    data: CreateAssignmentData,
    manager: EntityManager,
  ): Promise<ServiceRequestAssignmentRecord> {
    const rows: Array<{ id: string }> = await manager.query(
      `INSERT INTO service_request_assignments
         (service_request_id, worker_user_id, assigned_by_user_id,
          status, assigned_at_utc)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        data.serviceRequestId,
        data.workerUserId,
        data.assignedByUserId,
        data.status,
        data.assignedAtUtc,
      ],
    );

    const created = await this.findByIdWithManager(rows[0].id, manager);
    if (!created) throw new Error('Assignment insert succeeded but read-back failed');
    return created;
  }

  async update(
    id: string,
    data: UpdateAssignmentData,
    manager: EntityManager,
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const add = (col: string, val: unknown): void => {
      sets.push(`${col} = $${i++}`);
      params.push(val);
    };

    if (data.status !== undefined) add('status', data.status);
    if (data.acknowledgedAtUtc !== undefined) add('acknowledged_at_utc', data.acknowledgedAtUtc);
    if (data.declinedAtUtc !== undefined) add('declined_at_utc', data.declinedAtUtc);
    if (data.completedAtUtc !== undefined) add('completed_at_utc', data.completedAtUtc);

    if (sets.length === 0) return;
    sets.push(`updated_at_utc = now()`);
    params.push(id);

    await manager.query(
      `UPDATE service_request_assignments SET ${sets.join(', ')}
       WHERE id = $${i} AND deleted_at_utc IS NULL`,
      params,
    );
  }

  private async findByIdWithManager(
    id: string,
    manager: EntityManager,
  ): Promise<ServiceRequestAssignmentRecord | null> {
    const rows: RawAssignmentRow[] = await manager.query(
      `SELECT ${SELECT_COLUMNS} FROM service_request_assignments
       WHERE id = $1 AND deleted_at_utc IS NULL`,
      [id],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }
}
