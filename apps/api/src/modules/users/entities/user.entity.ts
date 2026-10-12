import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SystemRole } from '../enums/system-role.enum';
import { VerificationLevel } from '../enums/verification-level.enum';
import { UserAuthProvider } from './user-auth-provider.entity';

/**
 * `chk_users_terms_acceptance_paired` mirrors migration 1780540000000: the
 * acceptance date and the accepted version are NULL together or set together.
 * Without this mirror the next `migration:generate` would propose dropping it.
 */
@Check(
  'chk_users_terms_acceptance_paired',
  `("terms_accepted_at_utc" IS NULL) = ("terms_version" IS NULL)`,
)
@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  email!: string;

  @Column({ type: 'timestamp with time zone', nullable: true })
  emailVerifiedAtUtc!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  phone!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  phoneVerifiedAtUtc!: Date | null;

  @Column({ type: 'varchar' })
  firstName!: string;

  @Column({ type: 'varchar' })
  lastName!: string;

  @Column({ type: 'varchar', nullable: true })
  displayName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'varchar', default: 'fr-CA' })
  languagePreference!: string;

  @Column({ type: 'varchar', length: 2 })
  countryCode!: string;

  @Column({ type: 'varchar', length: 6 })
  subdivisionCode!: string;

  @Column({ type: 'varchar', length: 3 })
  preferredCurrency!: string;

  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  defaultLocation!: object | null;

  @Column({
    type: 'enum',
    enum: VerificationLevel,
    enumName: 'users_verification_level_enum',
    default: VerificationLevel.NONE,
    comment:
      'Declarative only, NOT enforced. No code path writes this column; SMS OTP is not implemented. Do not build guards on this value until OTP exists. See CLAUDE.md.',
  })
  verificationLevel!: VerificationLevel;

  @Column({
    type: 'enum',
    enum: SystemRole,
    enumName: 'users_system_role_enum',
    default: SystemRole.USER,
  })
  systemRole!: SystemRole;

  /** Stripe Customer id (cus_...), created lazily when the user saves a card. */
  @Column({ type: 'varchar', nullable: true })
  stripeCustomerId!: string | null;

  /**
   * Refresh tokens issued before this instant are rejected (`AuthService.refresh`).
   *
   * ⚠️ A REVOCATION BOUND, NOT A MIRROR OF THE PASSWORD. The password lives on
   * `user_auth_providers.password_hash`; this column says "everything older than
   * this is void", which is a strictly larger idea. A future authenticated
   * password change AND a future "sign out everywhere" must write it too — it is
   * not the private business of the reset flow.
   *
   * `NOT NULL` is deliberate: nullable, a branch that forgot to compare would let
   * every token through, and the omission would look exactly like a working
   * system. Compared against the JWT `iat` in SECONDS — see `AuthService.refresh`.
   *
   * The `comment` option mirrors the migration's `COMMENT ON COLUMN`; without it
   * the next `migration:generate` would propose removing the comment.
   */
  @Column({
    type: 'timestamp with time zone',
    default: () => 'now()',
    comment:
      'Refresh tokens issued before this instant are rejected. A revocation bound, NOT a mirror of the password: the password lives on user_auth_providers.password_hash, and this column must also be written by a future authenticated password change and by a future "sign out everywhere". Compared against the JWT iat in SECONDS.',
  })
  sessionsInvalidatedAtUtc!: Date;

  /**
   * Proof of consent (PR L2). Set ONCE, by the server, in the same transaction
   * as the user row (`UsersRepository.createWithEmailPassword`). Never received
   * from the client: the browser sends only its consent, the BFF adds the
   * version, the API checks it and stamps the date itself.
   *
   * ⚠️ NULL MEANS "NEVER ACCEPTED", NOT "UNKNOWN". Accounts created before L2 and
   * OAuth accounts carry NULL, and nothing backfills them — an invented date
   * would be a false proof. Never exposed in a response DTO.
   *
   * The `comment` options mirror the migration's `COMMENT ON COLUMN`.
   */
  @Column({
    type: 'timestamp with time zone',
    nullable: true,
    comment:
      'When the user accepted the terms and privacy policy, set by the server at signup. NULL = never accepted (accounts created before PR L2, and OAuth accounts). Never backfilled.',
  })
  termsAcceptedAtUtc!: Date | null;

  @Column({
    type: 'varchar',
    length: 10,
    nullable: true,
    comment:
      'Civil date (YYYY-MM-DD) of the legal texts accepted: LEGAL_VERSION on the web, CURRENT_TERMS_VERSION on the API. NULL = never accepted.',
  })
  termsVersion!: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;

  @OneToMany(() => UserAuthProvider, (authProvider) => authProvider.user)
  authProviders!: UserAuthProvider[];
}
