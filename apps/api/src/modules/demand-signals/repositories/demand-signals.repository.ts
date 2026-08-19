import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DemandSignal } from '../entities/demand-signal.entity';

/**
 * Everything a demand signal row is made of. There is no recipient, no author
 * and no owner — see the entity and migration 1780510000000 for why that absence
 * is the design and not a gap.
 *
 * `sectorLat` / `sectorLng` are ALREADY ROUNDED by the caller. The service
 * rounds; this interface only carries the result. Passing an exact coordinate
 * here would still be caught by the column scale, but the intent belongs
 * upstream, next to the coordinate's only other use.
 */
export interface CreateDemandSignalData {
  serviceCategoryId: string;
  sectorLat: number;
  sectorLng: number;
}

@Injectable()
export class DemandSignalsRepository {
  constructor(
    @InjectRepository(DemandSignal)
    private readonly repo: Repository<DemandSignal>,
  ) {}

  /**
   * Appends one signal. No transaction: a single row is already atomic and,
   * unlike a fan-out, it has no sibling row it must land with.
   *
   * Raw SQL with an explicit column list, like the rest of this codebase —
   * which also sidesteps the `numeric`-is-a-string dance TypeORM would impose
   * on a typed insert for a column nothing reads.
   */
  async insertOne(data: CreateDemandSignalData): Promise<void> {
    await this.repo.query(
      `INSERT INTO demand_signals (service_category_id, sector_lat, sector_lng)
       VALUES ($1, $2, $3)`,
      [data.serviceCategoryId, data.sectorLat, data.sectorLng],
    );
  }
}
