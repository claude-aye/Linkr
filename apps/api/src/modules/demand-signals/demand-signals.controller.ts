import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { DemandSignalsService } from './demand-signals.service';
import { RecordDemandSignalDto } from './dto/record-demand-signal.dto';

/**
 * The write surface of the demand map. The read surface is
 * `AdminDemandSignalsController` (`GET /admin/demand-signals`, ADMIN-only,
 * aggregated in SQL) — this route is still the map's ONLY writer.
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
/**
 * How many demand signals one caller may record per window.
 *
 * ⚠️ THIS BOUNDS INTENSITY; IT CANNOT DEDUPLICATE PEOPLE, AND NOTHING CAN.
 * Without an identity in the table, one person searching ten times is
 * indistinguishable from ten people searching once — the accepted price of the
 * anonymity that keeps a row out of scope as personal information
 * (CLAUDE.md §13.1). The residual threat this limiter leaves standing is an
 * authenticated account padding a genuinely empty sector: it distorts HOW MUCH,
 * never WHERE. Read the map as a direction, not a measurement.
 *
 * The figures: the browser records at most one signal per search per browsing
 * session, so even determined exploration — several trades across several
 * places — lands in single digits. Twenty is roughly four times that, far
 * enough above real use to be invisible to it. Fifteen minutes then caps a
 * padder at eighty an hour, which turns "poison a sector over a coffee" into
 * "sit here all day", and leaves a visible trail of 429s in the log while they
 * do.
 *
 * Constants rather than environment variables, deliberately: these describe the
 * shape of this route's honest traffic, not a per-deployment tuning knob. A
 * deployment that needed a different number would be a deployment where the
 * client behaves differently, which is a code change here.
 */
const SIGNAL_LIMIT = 20;
const SIGNAL_WINDOW_SECONDS = 15 * 60;

@ApiTags('demand-signals')
@UseGuards(RateLimitGuard)
@Controller('demand-signals')
export class DemandSignalsController {
  constructor(private readonly service: DemandSignalsService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: SIGNAL_LIMIT, windowSeconds: SIGNAL_WINDOW_SECONDS })
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
  @ApiResponse({
    status: 429,
    description:
      'The caller spent its budget for the current window. Carries `Retry-After`. Bounds how fast the map can be padded; it does NOT deduplicate people, which is impossible without an identity.',
  })
  record(@Body() dto: RecordDemandSignalDto): Promise<void> {
    return this.service.record(dto);
  }
}
