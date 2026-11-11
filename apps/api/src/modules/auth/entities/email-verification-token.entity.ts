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
 * A single-use email verification token — its SHA-256 hash and the address it
 * was issued for (mandate L1).
 *
 * ⚠️ The decorators mirror the migration (indexes, table and column comments);
 * without them `migration:generate` proposes dropping them. Same rule as
 * `PasswordResetToken`.
 */
@Entity({
  name: 'email_verification_tokens',
  comment:
    "Single-use email verification tokens. Stores SHA-256 of the token, never the token, and the address it was issued for: a token only verifies while that address is still the account's.",
})
@Index('ux_email_verification_tokens_hash', ['tokenHash'], { unique: true })
@Index('ix_email_verification_tokens_user_active', ['userId'], {
  where: '"consumed_at_utc" IS NULL',
})
export class EmailVerificationToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({
    type: 'text',
    comment:
      'SHA-256 (hex) of a 32-byte random, base64url-encoded token. The raw token lives only in the email and the queue payload.',
  })
  tokenHash!: string;

  @Column({
    type: 'varchar',
    comment:
      'Address the token was sent to, copied raw from users.email at issue time. Compared exactly (case-sensitive) at consume time.',
  })
  email!: string;

  @Column({ type: 'timestamp with time zone' })
  expiresAtUtc!: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  consumedAtUtc!: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;
}
