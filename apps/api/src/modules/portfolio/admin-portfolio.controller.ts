import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PortfolioService } from './portfolio.service';

/** Moderation: an admin removes a photo. Same effect as the owner's delete; the admin id is logged. */
@ApiTags('admin')
@Controller('admin/portfolio')
@UseGuards(AdminGuard)
export class AdminPortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Delete(':itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Remove any provider photo (ADMIN). The row is soft-deleted AND the file is deleted.',
  })
  @ApiResponse({ status: 204, description: '' })
  @ApiResponse({ status: 403, description: 'Not an admin.' })
  @ApiResponse({ status: 404, description: 'No such live photo.' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    return this.portfolio.deleteAsAdmin(user.sub, itemId);
  }
}
