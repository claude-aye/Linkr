import {
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

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;

  @OneToMany(() => UserAuthProvider, (authProvider) => authProvider.user)
  authProviders!: UserAuthProvider[];
}
