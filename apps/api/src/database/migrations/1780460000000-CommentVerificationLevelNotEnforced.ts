import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Documents `users.verification_level` as declarative-only, directly in the
 * database.
 *
 * The column has a state machine (NONE → EMAIL → PHONE → IDENTITY) but no code
 * path ever writes it: there is no SMS OTP, no sending dependency, and no
 * update DTO exposing it. It sits at NONE for every user, forever. A guard
 * built on it — such as the provider-creation gate removed in this change —
 * is a dead end, so the comment warns the next reader before they build one.
 *
 * Mirrored by the `comment` option on the entity column, so that a future
 * `migration:generate` does not try to drop it.
 */
export class CommentVerificationLevelNotEnforced1780460000000
  implements MigrationInterface
{
  name = 'CommentVerificationLevelNotEnforced1780460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      COMMENT ON COLUMN "users"."verification_level" IS 'Declarative only, NOT enforced. No code path writes this column; SMS OTP is not implemented. Do not build guards on this value until OTP exists. See CLAUDE.md.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      COMMENT ON COLUMN "users"."verification_level" IS NULL
    `);
  }
}
