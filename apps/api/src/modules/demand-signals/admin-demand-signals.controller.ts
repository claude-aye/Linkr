import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../common/guards/admin.guard';
import { DemandSignalsService } from './demand-signals.service';
import { DemandSignalSummaryListDto } from './dto/demand-signal-summary-list.dto';

/**
 * The read surface of the demand map — for Linkr staff, and nobody else.
 *
 * ⚠️ RBAC IS REUSED VERBATIM, NEVER REINVENTED. Same `AdminGuard`, same
 * `@Controller('admin')` prefix, same module-local provider registration as the
 * verification console (`AdminVerificationsController`), `AdminPaymentsController`
 * and `AdminServiceRequestsController`. The guard resolves the caller's
 * `system_role` from the database on every request — the JWT carries only
 * `{ sub, email, type }` and never a role. A second opinion on who is an
 * administrator would be a weaker opinion.
 *
 * Layering, since both guards run: the global `JwtAuthGuard` answers 401 for an
 * anonymous caller, and `AdminGuard` answers 403 for an authenticated non-admin.
 *
 * ⚠️ AGGREGATED ONLY — there is deliberately no route here that returns
 * individual rows. See `DemandSignalSummaryItemDto` for why: the aggregation is
 * what preserves the anonymity that session 6 built into the schema, and a read
 * layer is exactly where it would be lost without a single column changing.
 *
 * Not a client surface, not a public page, not product analytics: it answers
 * « which trade, in which sector, how many times », and nothing else.
 */
@ApiTags('demand-signals')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminDemandSignalsController {
  constructor(private readonly service: DemandSignalsService) {}

  @Get('demand-signals')
  @ApiOperation({
    summary:
      'Recruitment map: searches that returned zero providers, aggregated by trade and coarse sector. Aggregated in SQL — no individual row, no exact coordinate, and no timestamp finer than the day ever leaves the server. ADMIN only.',
  })
  @ApiOkResponse({ type: DemandSignalSummaryListDto })
  summarize(): Promise<DemandSignalSummaryListDto> {
    return this.service.summarize();
  }
}
