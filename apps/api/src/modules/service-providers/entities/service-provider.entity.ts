import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { ProviderType } from '../enums/provider-type.enum';
import { ProfessionalServiceZone } from './professional-service-zone.entity';

/**
 * Polymorphic commercial entity: an INDIVIDUAL (wraps a user) OR an
 * ORGANIZATION (wraps an org). All downstream catalog/request/payment tables
 * reference this — never users or organizations directly.
 *
 * GEO: `serviceBaseLocation` is geography(Point,4326). It is `select: false`
 * because raw geography is unreadable WKB; the repository always reads it via
 * `ST_AsGeoJSON(...)` and writes it via `ST_GeomFromGeoJSON(...)`.
 */
@Entity({ name: 'service_providers' })
export class ServiceProvider {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: ProviderType,
    enumName: 'service_provider_type',
  })
  providerType!: ProviderType;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  @Column({ type: 'uuid', nullable: true })
  organizationId!: string | null;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  businessName!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  headline!: string | null;

  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    select: false,
  })
  serviceBaseLocation!: object;

  @Column({ type: 'int' })
  serviceRadiusKm!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamp with time zone', nullable: true })
  activatedAtUtc!: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;

  @OneToMany(() => ProfessionalServiceZone, (zone) => zone.serviceProvider)
  zones!: ProfessionalServiceZone[];
}
