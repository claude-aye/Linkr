import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceProvider } from './service-provider.entity';

/**
 * Named geographic service zone (the "Zones" half of the hybrid geo model).
 * One zone = one contiguous polygon; disjoint coverage = multiple rows.
 *
 * GEO: `zonePolygon` is geography(Polygon,4326), `select: false` for the same
 * reason as ServiceProvider.serviceBaseLocation — read/write via PostGIS funcs.
 */
@Entity({ name: 'professional_service_zones' })
export class ProfessionalServiceZone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  serviceProviderId!: string;

  @ManyToOne(() => ServiceProvider, (provider) => provider.zones, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'service_provider_id' })
  serviceProvider!: ServiceProvider;

  @Column({
    type: 'geography',
    spatialFeatureType: 'Polygon',
    srid: 4326,
    select: false,
  })
  zonePolygon!: object;

  @Column({ type: 'varchar', length: 120 })
  zoneLabel!: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;
}
