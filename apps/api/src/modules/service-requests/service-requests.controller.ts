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
} from '@nestjs/common';
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
      'Accept a DIRECT_BOOKING (INDIVIDUAL provider only). Transitions request OPEN→ASSIGNED and creates an assignment.',
  })
  @ApiResponse({ status: 200, type: ServiceRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Not a DIRECT_BOOKING or missing provider' })
  @ApiResponse({ status: 403, description: 'Caller is not the targeted provider' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Invalid state transition' })
  @ApiResponse({ status: 422, description: 'ORGANIZATION dispatch not supported in MVP' })
  accept(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceRequestResponseDto> {
    return this.service.acceptRequest(id, user.sub);
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
