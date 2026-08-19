import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ServiceCategoryRepository } from '../services-catalog/repositories/service-category.repository';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { DemandSignalSummaryItemDto } from './dto/demand-signal-summary-item.dto';
import { DemandSignalSummaryListDto } from './dto/demand-signal-summary-list.dto';
import { RecordDemandSignalDto } from './dto/record-demand-signal.dto';
import { DemandSignalsRepository } from './repositories/demand-signals.repository';
import { toSector } from './sector';

/**
 * Hard cap on the number of (trade × sector) cells returned by the admin read.
 *
 * A server constant, not a query parameter: there is no pagination here and no
 * cursor, on purpose — a sorted table is the whole deliverable. The envelope's
 * `totalSectors` is what tells the reader the cap bit. 200 is generous against
 * the shape of the data (cells are far fewer than signals, and a cell only
 * exists where a search actually came back empty) while still bounding the
 * response.
 */
export const DEMAND_SIGNAL_SUMMARY_LIMIT = 200;

@Injectable()
export class DemandSignalsService {
  constructor(
    private readonly signalsRepo: DemandSignalsRepository,
    private readonly categoryRepo: ServiceCategoryRepository,
    private readonly providerRepo: ServiceProviderRepository,
  ) {}

  /**
   * Records that a search for `categoryId` around `(lat, lng)` found nobody.
   *
   * ⚠️ THE CLAIM IS VERIFIED, NOT TRUSTED — and the verification reuses the
   * SEARCH'S OWN PREDICATE. `findEligibleProviderIds` is the same
   * `eligibilityFromWhere()` that `discover` just ran, so the two cannot drift:
   * whatever the search counted, this counts again. Without it the table would
   * be a record of what clients *claimed*, and any authenticated caller could
   * poison the recruitment map with a handful of forged POSTs. With it, a row in
   * `demand_signals` is true by construction.
   *
   * It also closes the « a failed search must not be recorded » rule on the
   * server side: if this lookup itself throws, the exception propagates and
   * nothing is written. A 5xx is not an absence of supply, and conflating the
   * two would poison the map exactly as conflating the two kinds of zero would
   * have poisoned the empty state.
   *
   * ⚠️ EXACT IN, COARSE OUT. The verification runs on the exact point — that is
   * the only point whose emptiness was actually observed — and only the rounded
   * sector is handed to the repository. The exact coordinate is never persisted
   * and never logged.
   *
   * ⚠️ NOT DEDUPLICATED SERVER-SIDE, AND IT STRUCTURALLY CANNOT BE. Telling
   * « the same search seen twice » from « two different people searching the
   * same thing » requires knowing who is asking — the one thing this table
   * deliberately does not know. Dedup therefore lives at the only place that can
   * hold it without an identifier: the browser session that produced the search
   * (`demand-signal-recorder.tsx`). The unit of measure is one signal per search
   * per browsing session, never one per render.
   *
   * Regulated trades reached by a direct link produce a zero too, and are
   * recorded like any other: knowing how many people looked for a plumber is
   * precisely what will decide when to reopen that segment.
   */
  async record(dto: RecordDemandSignalDto): Promise<void> {
    const category = await this.categoryRepo.findById(dto.categoryId);
    if (!category) {
      throw new NotFoundException('Service category not found');
    }

    const eligible = await this.providerRepo.findEligibleProviderIds(
      dto.lng,
      dto.lat,
      dto.categoryId,
    );
    if (eligible.length > 0) {
      throw new ConflictException(
        'This search is not empty — no demand signal recorded',
      );
    }

    await this.signalsRepo.insertOne({
      serviceCategoryId: dto.categoryId,
      sectorLat: toSector(dto.lat),
      sectorLng: toSector(dto.lng),
    });
  }

  /**
   * The recruitment map, for an ADMIN: which trade, in which sector, how many
   * times a search came back empty.
   *
   * ⚠️ THIS METHOD NEVER SEES AN INDIVIDUAL SIGNAL, AND THAT IS THE DESIGN. The
   * grouping happens in SQL (see {@link DemandSignalsRepository.findSectorSummary});
   * pulling rows here to group them in TypeScript would mean the raw table —
   * microsecond timestamps included — had already crossed the process boundary.
   * The same reasoning forbids doing it in the browser.
   *
   * No filters, no window parameter, no export: a sorted table is the whole
   * deliverable, and every one of those is a separate responsibility.
   */
  async summarize(): Promise<DemandSignalSummaryListDto> {
    const { items, totalSectors, totalSignals } =
      await this.signalsRepo.findSectorSummary(DEMAND_SIGNAL_SUMMARY_LIMIT);

    const dto = new DemandSignalSummaryListDto();
    dto.items = items.map((record) => DemandSignalSummaryItemDto.from(record));
    dto.totalSectors = totalSectors;
    dto.totalSignals = totalSignals;
    dto.limit = DEMAND_SIGNAL_SUMMARY_LIMIT;
    return dto;
  }
}
