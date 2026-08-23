import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * A single-use password reset token — or rather, its SHA-256 hash.
 *
 * ⚠️ THE DECORATORS BELOW ARE LOAD-BEARING MIRRORS OF THE MIGRATION, not
 * decoration. Everything the migration installs that TypeORM cannot infer from a
 * plain column — the two index definitions, the table comment, the column
 * comments — has to be restated here, or the next `migration:generate` will
 * propose DROPPING them. The same trap was measured on `demand_signals`
 * (CLAUDE.md, session 6) and on `notifications`.
 *
 * No `updatedAtUtc`, no `deletedAtUtc`: a row is inserted, consumed once, and
 * never edited (see the migration docblock).
 */
@Entity({
  name: 'password_reset_tokens',
  // Mirrors the migration's COMMENT ON TABLE. Measured, not assumed: without it,
  // `migration:generate` proposes `COMMENT ON TABLE ... IS NULL`.
  comment:
    'Single-use password reset tokens. Stores SHA-256 of the token, never the token. Rows are found by token_hash only — never by user — so a lookup cannot leak whether an account exists.',
})
@Index('ux_password_reset_tokens_hash', ['tokenHash'], { unique: true })
@Index('ix_password_reset_tokens_user_active', ['userId'], {
  where: '"consumed_at_utc" IS NULL',
})
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /**
   * SHA-256 (hex) of the raw token. The raw value is NEVER stored — see the
   * migration docblock for why that closes the "re-read the secret at send time"
   * shortcut rather than merely discouraging it.
   */
  @Column({
    type: 'text',
    comment:
      'SHA-256 (hex) of a 32-byte random, base64url-encoded token. The raw token lives only in the email and the queue payload.',
  })
  tokenHash!: string;

  @Column({ type: 'timestamp with time zone' })
  expiresAtUtc!: Date;

  /** Stamped by the single conditional UPDATE that consumes the token. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  consumedAtUtc!: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;
}
