import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateServiceRequestAssignments1780400000000 implements MigrationInterface {
  name = 'CreateServiceRequestAssignments1780400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE service_request_assignment_status AS ENUM (
        'ASSIGNED',
        'ACCEPTED_BY_WORKER',
        'DECLINED_BY_WORKER',
        'COMPLETED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE service_request_assignments (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        service_request_id  UUID NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
        worker_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        assigned_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        status              service_request_assignment_status NOT NULL,
        assigned_at_utc     TIMESTAMPTZ NOT NULL,
        acknowledged_at_utc TIMESTAMPTZ,
        declined_at_utc     TIMESTAMPTZ,
        completed_at_utc    TIMESTAMPTZ,
        created_at_utc      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at_utc      TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at_utc      TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_sra_service_request_id
        ON service_request_assignments (service_request_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_sra_worker_user_id
        ON service_request_assignments (worker_user_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_sra_status
        ON service_request_assignments (status)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_sra_one_live_per_request
        ON service_request_assignments (service_request_id)
        WHERE deleted_at_utc IS NULL AND status <> 'DECLINED_BY_WORKER'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_sra_one_live_per_request`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sra_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sra_worker_user_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sra_service_request_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_request_assignments`);
    await queryRunner.query(`DROP TYPE IF EXISTS service_request_assignment_status`);
  }
}
