import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RegulationLevel } from '../enums/regulation-level.enum';
import { ServiceItem } from './service-item.entity';
import { RegulatoryRequirement } from './regulatory-requirement.entity';

@Entity({ name: 'service_categories' })
export class ServiceCategory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'jsonb' })
  nameTranslations!: Record<string, string>;

  @Column({ type: 'jsonb', default: '{}' })
  descriptionTranslations!: Record<string, string>;

  @Column({ type: 'varchar', nullable: true })
  iconUrl!: string | null;

  @Column({
    type: 'enum',
    enum: RegulationLevel,
    enumName: 'service_category_regulation_level',
  })
  regulationLevel!: RegulationLevel;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAtUtc!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAtUtc!: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true })
  deletedAtUtc!: Date | null;

  @OneToMany(() => ServiceItem, (item) => item.serviceCategory)
  items!: ServiceItem[];

  @OneToMany(() => RegulatoryRequirement, (req) => req.serviceCategory)
  requirements!: RegulatoryRequirement[];
}
