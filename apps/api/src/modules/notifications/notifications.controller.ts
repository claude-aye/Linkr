import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { NotificationListDto } from './dto/notification-list.dto';
import { NotificationReadResponseDto } from './dto/notification-read-response.dto';
import { NotificationsService } from './notifications.service';

/**
 * The read surface of a table that, until now, was only ever written to.
 *
 * Authenticated by the global `JwtAuthGuard` (APP_GUARD, auth.module.ts) — no
 * `@Public()` anywhere here, and the recipient is derived from the caller's own
 * `sub`, so there is no id to own-check on the listing.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary:
      "The caller's notifications — those addressed to them personally OR to a provider profile they own — newest first, capped at 50. No cursor, no paging. unreadCount counts the whole set, not the page.",
  })
  @ApiResponse({ status: 200, type: NotificationListDto })
  list(@CurrentUser() user: JwtPayload): Promise<NotificationListDto> {
    return this.service.listForUser(user.sub);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Mark a notification read. Idempotent — a repeat call keeps the first read timestamp. 404 (never 403) when it targets neither the caller nor their provider profiles.',
  })
  @ApiResponse({ status: 200, type: NotificationReadResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Unknown, soft-deleted, or not addressed to the caller.',
  })
  markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationReadResponseDto> {
    return this.service.markRead(user.sub, id);
  }
}
