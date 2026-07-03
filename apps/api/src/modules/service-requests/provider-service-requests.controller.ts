import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ServiceProvidersService } from '../service-providers/service-providers.service';
import { ListProviderServiceRequestsDto } from './dto/list-provider-service-requests.dto';
import { ProviderServiceRequestListDto } from './dto/provider-service-request-list.dto';
import { ServiceRequestsService } from './service-requests.service';

/**
 * Provider dashboard: `GET /service-providers/:id/service-requests` (Vision B).
 *
 * Routing note (cf. CLAUDE.md §6 — anti-circular-dependency): the URL lives
 * under the `service-providers/:id` namespace, but the handler is declared in
 * the **service-requests** module — deliberately NOT appended to
 * `ServiceProvidersController`. `ServiceProvidersModule` is a widely-imported
 * "sink" (notifications, payments → stripe-connect, quotes, verifications all
 * import it); having it import `ServiceRequestsModule` back cascades module
 * cycles across all of them (verified at boot — Notifications, then
 * StripeConnect, … each break). Declaring the controller here keeps the edge
 * one-way (`service-requests → service-providers`, already existing): ZERO
 * forwardRef, zero cycle. Ownership still lives on the providers side
 * (`loadOwnedProvider`), the listing in the service-requests domain — the exact
 * separation §6 asks for.
 */
@ApiTags('service-providers')
@Controller('service-providers')
export class ProviderServiceRequestsController {
  constructor(
    private readonly providersService: ServiceProvidersService,
    private readonly requestsService: ServiceRequestsService,
  ) {}

  @Get(':id/service-requests')
  @ApiOperation({
    summary:
      "Provider dashboard (owner only): list this provider's service requests — assigned jobs + DIRECT_BOOKINGs still OPEN and targeted at it (Vision B). Items carry joined i18n trade/service labels + client name; GPS excluded (Loi 25).",
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiResponse({ status: 200, type: ProviderServiceRequestListDto })
  @ApiResponse({ status: 403, description: 'You do not own this provider.' })
  @ApiResponse({ status: 404, description: 'Service provider not found.' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListProviderServiceRequestsDto,
  ): Promise<ProviderServiceRequestListDto> {
    // Ownership stays on the providers side (404 if missing, 403 if not owned),
    // THEN delegate the listing to the service-requests domain (its data).
    await this.providersService.loadOwnedProvider(user.sub, id);
    return this.requestsService.listForProvider(id, query);
  }
}
