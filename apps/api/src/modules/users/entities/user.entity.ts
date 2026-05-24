import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
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
  })
  verificationLevel!: VerificationLevel;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;

  @OneToMany(() => UserAuthProvider, (authProvider) => authProvider.user)
  authProviders!: UserAuthProvider[];
}
