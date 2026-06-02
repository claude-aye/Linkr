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
import { ListServiceRequestsDto } from './dto/list-service-requests.dto';
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
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListServiceRequestsDto,
  ): Promise<{
    items: ServiceRequestResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
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
}
