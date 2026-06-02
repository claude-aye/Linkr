import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ServiceRequestsService } from './service-requests.service';

@ApiTags('service-requests')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminServiceRequestsController {
  constructor(private readonly service: ServiceRequestsService) {}

  @Post('service-requests/run-expiry-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Manually trigger the OPEN→EXPIRED expiry check (same logic as the 5-min cron).',
  })
  runExpiryCheck(): Promise<{ expired: number }> {
    return this.service.runExpiryCheck();
  }
}
