import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceItem } from './entities/service-item.entity';
import { RegulatoryRequirement } from './entities/regulatory-requirement.entity';
import { ServicesCatalogService } from './services-catalog.service';

@ApiTags('services-catalog')
@Controller('service-categories')
@Public()
export class ServicesCatalogPublicController {
  constructor(private readonly catalogService: ServicesCatalogService) {}

  @Get()
  @ApiOperation({ summary: 'List all active service categories' })
  listCategories(): Promise<ServiceCategory[]> {
    return this.catalogService.listPublicCategories();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get an active service category by slug' })
  getCategory(@Param('slug') slug: string): Promise<ServiceCategory> {
    return this.catalogService.getCategoryBySlug(slug);
  }

  @Get(':slug/items')
  @ApiOperation({ summary: 'List approved items for a service category' })
  listItems(@Param('slug') slug: string): Promise<ServiceItem[]> {
    return this.catalogService.listApprovedItems(slug);
  }

  @Get(':slug/requirements')
  @ApiOperation({ summary: 'List regulatory requirements for a category and geo zone' })
  @ApiQuery({ name: 'country', required: true, example: 'CA' })
  @ApiQuery({ name: 'subdivision', required: false, example: 'CA-QC' })
  listRequirements(
    @Param('slug') slug: string,
    @Query('country') country: string,
    @Query('subdivision') subdivision?: string,
  ): Promise<RegulatoryRequirement[]> {
    return this.catalogService.listRequirements(slug, country, subdivision);
  }
}
