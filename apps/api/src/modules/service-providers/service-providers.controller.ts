import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateServiceProviderDto } from './dto/create-service-provider.dto';
import { UpdateServiceProviderDto } from './dto/update-service-provider.dto';
import { ServiceProviderResponseDto } from './dto/service-provider-response.dto';
import { DiscoverProvidersQueryDto } from './dto/discover-providers-query.dto';
import { DiscoveredProviderDto } from './dto/discovered-provider.dto';
import { ServiceProvidersService } from './service-providers.service';

@ApiTags('service-providers')
@Controller('service-providers')
export class ServiceProvidersController {
  constructor(private readonly providersService: ServiceProvidersService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a service provider (polymorphic). INDIVIDUAL derives user_id from JWT; ORGANIZATION requires organizationId and active OWNER role. GeoJSON Point coordinates are [lng, lat].',
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateServiceProviderDto,
  ): Promise<ServiceProviderResponseDto> {
    return this.providersService.createProvider(user.sub, dto);
  }

  // ⚠️ Must be declared BEFORE @Get(':id'), otherwise 'discover' is captured as an :id.
  @Get('discover')
  @ApiOperation({
    summary:
      'Discover providers covering a client location for a category (radius OR named zone), sorted by distance. Authenticated users only.',
  })
  @ApiQuery({ name: 'lat', type: Number, required: true })
  @ApiQuery({ name: 'lng', type: Number, required: true })
  @ApiQuery({ name: 'categoryId', type: String, required: true })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiResponse({ status: 200, type: DiscoveredProviderDto, isArray: true })
  @ApiResponse({ status: 400, description: 'Missing or invalid lat/lng/categoryId.' })
  discover(@Query() query: DiscoverProvidersQueryDto): Promise<{
    items: DiscoveredProviderDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.providersService.discover(query);
  }

  // ⚠️ Must be declared BEFORE @Get(':id'), otherwise 'me' is captured as an
  // :id and ParseUUIDPipe rejects it (400). Authenticated (no @Public()) — same
  // global JwtAuthGuard as the other owner routes; the provider is derived from
  // the caller's own JWT sub, so it is owner-safe with no :id to check.
  @Get('me')
  @ApiOperation({
    summary:
      "Resolve the authenticated user's own provider (Pro dashboard identity). Same contract as GET :id; returns even when is_active = false (paused). 404 if the user never activated Pro mode.",
  })
  @ApiResponse({ status: 200, type: ServiceProviderResponseDto })
  @ApiResponse({ status: 404, description: 'The authenticated user has no provider.' })
  getMine(@CurrentUser() user: JwtPayload): Promise<ServiceProviderResponseDto> {
    return this.providersService.getMine(user.sub);
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Public provider profile; geo returned as GeoJSON, business_name resolved.',
  })
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceProviderResponseDto> {
    return this.providersService.getPublicById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update editable provider fields (owner only).' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceProviderDto,
  ): Promise<ServiceProviderResponseDto> {
    return this.providersService.updateProvider(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a provider (owner only).' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.providersService.deleteProvider(user.sub, id);
  }
}
