import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DemandSignalsService } from './demand-signals.service';
import { RecordDemandSignalDto } from './dto/record-demand-signal.dto';

/**
 * The write surface of the demand map — and, for now, its only surface. Nothing
 * reads it back: exploiting the map (an admin table, an export) is a separate
 * piece of work, and a SQL probe is enough until then.
 *
 * ⚠️ A POST, NEVER A GET, AND THAT IS THE WHOLE POINT. `/recherche` decides
 * `total === 0` while a Server Component renders, and writing from there would
 * count link prefetches, double renders, `router.refresh()` and back-navigations
 * — a map built on renders measures the browser, not the market. The write is
 * therefore an explicit mutation, on the sanctioned BFF mutation path
 * (CLAUDE.md §13.1 entry 6).
 *
 * ⚠️ THE CALLER'S IDENTITY IS NEVER READ. The global `JwtAuthGuard` gates the
 * route (no `@Public()` — every searcher is authenticated, `/recherche` is
 * private), but there is no `@CurrentUser()` here and no user field anywhere
 * downstream. Authentication decides WHO MAY WRITE; it contributes nothing to
 * WHAT IS WRITTEN. Keep it that way — see migration 1780510000000.
 *
 * 204 rather than 201: the caller gets nothing back because there is nothing it
 * could do with a row it cannot read, and inventing a payload to look
 * conventional would be a small lie in the contract.
 */
@ApiTags('demand-signals')
@Controller('demand-signals')
export class DemandSignalsController {
  constructor(private readonly service: DemandSignalsService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Record an anonymous demand signal for a search that returned zero providers. The zero claim is re-verified server-side with discovery\'s own predicate; the coordinate is rounded to a coarse sector and the exact point is never stored. Stores NO caller identity.',
  })
  @ApiResponse({ status: 204, description: 'Signal recorded.' })
  @ApiResponse({ status: 400, description: 'Malformed body.' })
  @ApiResponse({ status: 404, description: 'Unknown service category.' })
  @ApiResponse({
    status: 409,
    description:
      'The search is not empty at this point for this trade — nothing recorded.',
  })
  record(@Body() dto: RecordDemandSignalDto): Promise<void> {
    return this.service.record(dto);
  }
}
