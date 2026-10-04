import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CancelServiceRequestDto } from './dto/cancel-service-request.dto';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { DeclineServiceRequestDto } from './dto/decline-service-request.dto';
import { ListServiceRequestsDto } from './dto/list-service-requests.dto';
import { ServiceRequestListDto } from './dto/service-request-list.dto';
import { ServiceRequestResponseDto } from './dto/service-request-response.dto';
import { DepositAwaitingConfirmationListDto } from './dto/deposit-awaiting-confirmation.dto';
import { DepositConfirmationResponseDto } from './dto/deposit-confirmation-response.dto';
import { ServiceRequestsService } from './service-requests.service';

@ApiTags('service-requests')
@Controller('service-requests')
export class ServiceRequestsController {
  constructor(private readonly service: ServiceRequestsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a service request (OPEN immediately). DIRECT_BOOKING requires serviceItemId + requestedServiceProviderId. PROJECT_TENDER must not specify requestedServiceProviderId.',
  })
  @ApiResponse({ status: 201, type: ServiceRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error or inactive/unknown provider' })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateServiceRequestDto,
  ): Promise<ServiceRequestResponseDto> {
    return this.service.create(user.sub, dto);
  }

  // ⚠️ Declared BEFORE `GET :id`: otherwise the literal segment is captured as
  // an `:id` and `ParseUUIDPipe` answers 400.
  @Get('deposits-awaiting-confirmation')
  @ApiOperation({
    summary:
      'Deposits the caller, as the client, can still confirm from their browser: DEPOSIT FAILED with a PaymentIntent, on a live request (ASSIGNED / IN_PROGRESS / COMPLETED). Local database only — no Stripe read.',
  })
  @ApiResponse({ status: 200, type: DepositAwaitingConfirmationListDto })
  listDepositsAwaitingConfirmation(
    @CurrentUser() user: JwtPayload,
  ): Promise<DepositAwaitingConfirmationListDto> {
    return this.service.listDepositsAwaitingConfirmation(user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a service request by ID (owner or ADMIN).' })
  @ApiResponse({ status: 200, type: ServiceRequestResponseDto })
  @ApiResponse({ status: 403, description: 'Not the owner' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceRequestResponseDto> {
    return this.service.findById(id, user.sub);
  }

  @Get()
  @ApiOperation({
    summary:
      'List service requests. Clients see only their own; ADMIN sees all. Filterable by status/requestType.',
  })
  @ApiResponse({ status: 200, type: ServiceRequestListDto })
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListServiceRequestsDto,
  ): Promise<ServiceRequestListDto> {
    return this.service.list(user.sub, query);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an OPEN service request (owner or ADMIN).' })
  @ApiResponse({ status: 200, type: ServiceRequestResponseDto })
  @ApiResponse({ status: 403, description: 'Not the owner' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Invalid state transition' })
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelServiceRequestDto,
  ): Promise<ServiceRequestResponseDto> {
    return this.service.cancel(id, user.sub, dto);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Accept a DIRECT_BOOKING (INDIVIDUAL provider only). Transitions request OPEN→ASSIGNED and creates an assignment. 200 when the deposit was captured, 202 when it was not — the assignment stands either way.',
  })
  @ApiResponse({ status: 200, type: ServiceRequestResponseDto })
  @ApiResponse({
    status: 202,
    type: ServiceRequestResponseDto,
    description:
      'Assigned, but the deposit did not settle. The job is the provider’s; the deposit is retryable via POST :id/retry-deposit.',
  })
  @ApiResponse({ status: 400, description: 'Not a DIRECT_BOOKING or missing provider' })
  @ApiResponse({
    status: 403,
    description:
      'Caller is not the targeted provider, or the targeted provider can no longer practise the request’s service category (paused, removed, or its verification is no longer valid)',
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Invalid state transition' })
  @ApiResponse({ status: 422, description: 'ORGANIZATION dispatch not supported, or no amount to base a deposit on' })
  async accept(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    // `passthrough: true` — Nest keeps serializing the returned value; a bare
    // @Res() would hand us the raw response and silently disable that. Used
    // here, and only here, because the two outcomes share ONE body and differ
    // only by status: the FR copy is mapped from the status ALONE (locked in
    // 3.12b), so the distinction has to live in the status line.
    @Res({ passthrough: true }) res: Response,
  ): Promise<ServiceRequestResponseDto> {
    const outcome = await this.service.acceptRequest(id, user.sub);
    if (!outcome.depositSettled) {
      res.status(HttpStatus.ACCEPTED);
    }
    return outcome.request;
  }

  @Post(':id/retry-deposit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Re-attempt the deposit on a job already assigned to the caller. Idempotent: a settled or in-flight deposit is left alone, and a retry never creates a second PaymentIntent.',
  })
  @ApiResponse({ status: 200, type: ServiceRequestResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not the assigned worker' })
  @ApiResponse({ status: 404, description: 'Not found or no active assignment' })
  @ApiResponse({
    status: 409,
    description:
      'Request is not in a state where a deposit applies, no agreed price is on file (accepted tender without an ACCEPTED quote), or the deposit record and its existing payment intent disagree on the amount (nothing is confirmed)',
  })
  @ApiResponse({ status: 422, description: 'No amount to base a deposit on' })
  @ApiResponse({ status: 502, description: 'Stripe rejected the deposit charge' })
  retryDeposit(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceRequestResponseDto> {
    return this.service.retryDeposit(id, user.sub);
  }

  @Post(':id/deposit-confirmation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Client only. Prepare the browser-side confirmation of the deposit’s EXISTING PaymentIntent (3-D Secure, or a declined card since replaced). Reads the intent at Stripe, points the payment row at the client’s current default card, and returns the client secret. Creates and confirms nothing server-side.',
  })
  @ApiResponse({ status: 200, type: DepositConfirmationResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not the client of this request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({
    status: 409,
    description:
      'Nothing to confirm: request not live, deposit not FAILED or without a PaymentIntent, intent cancelled, intent already settled (the row is reconciled first), or the ledger row and the intent disagree on the amount',
  })
  @ApiResponse({ status: 422, description: 'The client has no default card to confirm with' })
  @ApiResponse({ status: 502, description: 'The PaymentIntent could not be read at Stripe' })
  prepareDepositConfirmation(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepositConfirmationResponseDto> {
    return this.service.prepareDepositConfirmation(id, user.sub);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Decline a DIRECT_BOOKING (INDIVIDUAL provider only). Transitions request OPEN→CANCELLED.',
  })
  @ApiResponse({ status: 200, type: ServiceRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Not a DIRECT_BOOKING or missing provider' })
  @ApiResponse({ status: 403, description: 'Caller is not the targeted provider' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Invalid state transition' })
  @ApiResponse({ status: 422, description: 'ORGANIZATION dispatch not supported in MVP' })
  decline(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineServiceRequestDto,
  ): Promise<ServiceRequestResponseDto> {
    return this.service.declineRequest(id, user.sub, dto);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Start an ASSIGNED request (worker only). Transitions assignment ASSIGNED→ACCEPTED_BY_WORKER and request ASSIGNED→IN_PROGRESS.',
  })
  @ApiResponse({ status: 200, type: ServiceRequestResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not the assigned worker' })
  @ApiResponse({ status: 404, description: 'Not found or no active assignment' })
  @ApiResponse({ status: 409, description: 'Invalid state transition' })
  start(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceRequestResponseDto> {
    return this.service.startRequest(id, user.sub);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Complete an IN_PROGRESS request (worker only). Transitions assignment ACCEPTED_BY_WORKER→COMPLETED and request IN_PROGRESS→COMPLETED.',
  })
  @ApiResponse({ status: 200, type: ServiceRequestResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not the assigned worker' })
  @ApiResponse({ status: 404, description: 'Not found or no active assignment' })
  @ApiResponse({ status: 409, description: 'Invalid state transition' })
  complete(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceRequestResponseDto> {
    return this.service.completeRequest(id, user.sub);
  }

  @Post(':id/confirm-completion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Client confirms a COMPLETED job, triggering the 80% balance capture. The request flips to PAID asynchronously once the balance settles (webhook). Client (request owner) only.',
  })
  @ApiResponse({ status: 200, type: ServiceRequestResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not the request owner' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({
    status: 409,
    description: 'Request not COMPLETED, contested, or deposit not settled',
  })
  @ApiResponse({ status: 502, description: 'Stripe rejected the balance charge' })
  confirmCompletion(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceRequestResponseDto> {
    return this.service.confirmCompletion(id, user.sub);
  }

  @Post(':id/contest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Client contests a COMPLETED job, freezing the balance auto-release timer and routing to admin. Client (request owner) only.',
  })
  @ApiResponse({ status: 200, type: ServiceRequestResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not the request owner' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Request not COMPLETED or already contested' })
  contest(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceRequestResponseDto> {
    return this.service.contest(id, user.sub);
  }
}
