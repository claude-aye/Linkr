import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  GEOCODING_SERVICE,
  IGeocodingService,
} from '../../common/geocoding/geocoding.interface';
import { GeocodeQueryDto } from './dto/geocode-query.dto';
import { GeocodeResultDto } from './dto/geocode-result.dto';

@ApiTags('geocoding')
@Controller('geocode')
export class GeocodingController {
  constructor(
    @Inject(GEOCODING_SERVICE)
    private readonly geocodingService: IGeocodingService,
  ) {}

  // JWT-guarded by the global JwtAuthGuard (no @Public()) — same posture as
  // GET /service-providers/discover, which consumes these coordinates.
  @Get()
  @ApiOperation({
    summary:
      'Geocode a free-text address into a list of {label, lat, lng} candidates (Nominatim proxy). Authenticated users only. Zero matches → 200 with an empty list.',
  })
  @ApiResponse({ status: 200, type: GeocodeResultDto })
  @ApiResponse({ status: 400, description: 'Missing or empty q.' })
  @ApiResponse({
    status: 502,
    description: 'Upstream geocoding provider unavailable.',
  })
  async geocode(@Query() query: GeocodeQueryDto): Promise<GeocodeResultDto> {
    const candidates = await this.geocodingService.geocode(
      query.q,
      query.limit ?? 5,
    );
    return { candidates };
  }
}
