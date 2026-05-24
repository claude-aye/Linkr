import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuthProviderType } from '../enums/auth-provider-type.enum';
import { User } from './user.entity';

@Entity({ name: 'user_auth_providers' })
export class UserAuthProvider {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, (user) => user.authProviders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({
    type: 'enum',
    enum: AuthProviderType,
    enumName: 'user_auth_providers_provider_type_enum',
  })
  providerType!: AuthProviderType;

  @Column({ type: 'varchar', nullable: true })
  providerUserId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'timestamp with time zone', default: () => 'now()' })
  lastUsedAtUtc!: Date;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;
}
