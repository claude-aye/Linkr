import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  EMAIL_NOT_VERIFIED_RESPONSE_DESCRIPTION,
  RequireVerifiedEmail,
} from '../../common/guards/require-verified-email.decorator';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CalendarService } from './calendar.service';
import {
  TIME_OFF_MAX_DAYS,
  TIME_OFF_MAX_UPCOMING,
  WEEKLY_HOURS_MAX_RANGES_PER_DAY,
} from './constants';
import { CalendarFeedDto } from './dto/calendar-feed.dto';
import {
  AvailabilityQueryDto,
  ProviderAvailabilityDto,
} from './dto/provider-availability.dto';
import { CalendarRangeQueryDto, ProviderCalendarDto } from './dto/provider-calendar.dto';
import { CreateTimeOffDto, TimeOffDto } from './dto/time-off.dto';
import { UpdateWeeklyHoursDto, WeeklyHoursDto } from './dto/weekly-hours.dto';

/**
 * Budgets, per caller (the routes are authenticated, so the key is the account).
 * Generous for a person editing a schedule by hand, tight for a script.
 */
const WEEKLY_HOURS_RATE_LIMIT = { limit: 30, windowSeconds: 60 * 60 };
const TIME_OFF_RATE_LIMIT = { limit: 60, windowSeconds: 60 * 60 };
const FEED_LINK_RATE_LIMIT = { limit: 10, windowSeconds: 60 * 60 };

/**
 * A calendar app polls its subscription every few hours; many subscribers can
 * sit behind the same fetcher address (Google, Microsoft). Wide enough for
 * that, and still a ceiling on someone hammering the route.
 */
const FEED_READ_RATE_LIMIT = { limit: 300, windowSeconds: 15 * 60 };

const ICS_CONTENT_TYPE = 'text/calendar; charset=utf-8';

/**
 * Provider calendar — the owner's `me` routes and the availability another
 * user may read.
 *
 * `me/calendar…` and `:id/availability` share the `service-providers` prefix,
 * like the portfolio. They cannot shadow each other (different second
 * segments), and `me` is still declared first, by the same habit.
 */
@ApiTags('calendar')
@UseGuards(RateLimitGuard)
@Controller('service-providers')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('me/calendar')
  @ApiOperation({
    summary:
      "The authenticated provider's calendar over a window: appointments (read live from the service requests), blocked periods, published weekly hours and feed status. 404 if the user has no provider.",
  })
  @ApiResponse({ status: 200, type: ProviderCalendarDto })
  @ApiResponse({ status: 400, description: 'Malformed, inverted or too wide window.' })
  @ApiResponse({ status: 404, description: 'The authenticated user has no provider.' })
  getMine(
    @CurrentUser() user: JwtPayload,
    @Query() query: CalendarRangeQueryDto,
  ): Promise<ProviderCalendarDto> {
    return this.calendar.getMine(user.sub, query.from, query.to);
  }

  @Put('me/calendar/weekly-hours')
  @RateLimit(WEEKLY_HOURS_RATE_LIMIT)
  @RequireVerifiedEmail()
  @ApiOperation({
    summary: `Replace the published weekly opening hours as a whole (wall time of the calendar's zone, quarter-hours, at most ${WEEKLY_HOURS_MAX_RANGES_PER_DAY} ranges per weekday, no overlap). An empty array unpublishes them.`,
  })
  @ApiResponse({ status: 200, type: WeeklyHoursDto })
  @ApiResponse({ status: 400, description: 'Malformed body.' })
  @ApiResponse({ status: 403, description: EMAIL_NOT_VERIFIED_RESPONSE_DESCRIPTION })
  @ApiResponse({ status: 404, description: 'The authenticated user has no provider.' })
  @ApiResponse({
    status: 422,
    description:
      'Not a valid schedule. Body carries a code: WEEKLY_HOURS_BAD_RANGE, _OFF_GRID, _TOO_MANY_RANGES or _OVERLAP.',
  })
  @ApiResponse({ status: 429, description: 'Too many updates.' })
  saveWeeklyHours(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateWeeklyHoursDto,
  ): Promise<WeeklyHoursDto> {
    return this.calendar.saveWeeklyHours(user.sub, dto.weeklyHours);
  }

  @Post('me/calendar/time-off')
  @RateLimit(TIME_OFF_RATE_LIMIT)
  @RequireVerifiedEmail()
  @ApiOperation({
    summary: `Block a period (no appointment offered during it). It must not be over already, nor exceed ${TIME_OFF_MAX_DAYS} days; at most ${TIME_OFF_MAX_UPCOMING} periods not over yet. The label is private.`,
  })
  @ApiResponse({ status: 201, type: TimeOffDto })
  @ApiResponse({ status: 400, description: 'Malformed body, or label too long.' })
  @ApiResponse({ status: 403, description: EMAIL_NOT_VERIFIED_RESPONSE_DESCRIPTION })
  @ApiResponse({ status: 404, description: 'The authenticated user has no provider.' })
  @ApiResponse({
    status: 409,
    description: `Already ${TIME_OFF_MAX_UPCOMING} upcoming periods. Body carries code TIME_OFF_LIMIT_REACHED.`,
  })
  @ApiResponse({
    status: 422,
    description: 'The period ends before it starts, is already over, or is too long.',
  })
  @ApiResponse({ status: 429, description: 'Too many additions.' })
  addTimeOff(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTimeOffDto,
  ): Promise<TimeOffDto> {
    return this.calendar.addTimeOff(user.sub, dto);
  }

  @Delete('me/calendar/time-off/:timeOffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one of your blocked periods (soft delete).' })
  @ApiResponse({ status: 204, description: '' })
  @ApiResponse({ status: 404, description: 'No such live period of yours.' })
  removeTimeOff(
    @CurrentUser() user: JwtPayload,
    @Param('timeOffId', ParseUUIDPipe) timeOffId: string,
  ): Promise<void> {
    return this.calendar.removeTimeOff(user.sub, timeOffId);
  }

  @Post('me/calendar/feed')
  @RateLimit(FEED_LINK_RATE_LIMIT)
  @RequireVerifiedEmail()
  @ApiOperation({
    summary:
      'Generate the iCal subscription link (Outlook, Google Calendar, Apple Calendar…). The token is returned ONCE and stored hashed; calling again replaces it and revokes the previous link.',
  })
  @ApiResponse({ status: 201, type: CalendarFeedDto })
  @ApiResponse({ status: 403, description: EMAIL_NOT_VERIFIED_RESPONSE_DESCRIPTION })
  @ApiResponse({ status: 404, description: 'The authenticated user has no provider.' })
  @ApiResponse({ status: 429, description: 'Too many links generated.' })
  createFeed(@CurrentUser() user: JwtPayload): Promise<CalendarFeedDto> {
    return this.calendar.createFeed(user.sub);
  }

  @Delete('me/calendar/feed')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the iCal subscription link. Idempotent.' })
  @ApiResponse({ status: 204, description: '' })
  @ApiResponse({ status: 404, description: 'The authenticated user has no provider.' })
  revokeFeed(@CurrentUser() user: JwtPayload): Promise<void> {
    return this.calendar.revokeFeed(user.sub);
  }

  @Get('me/calendar/export')
  @ApiOperation({
    summary:
      "The provider's calendar as an .ics file, for a one-off import. Same content as the feed: appointments named after the catalogue trade and service, blocked periods — no client name, title or address.",
  })
  @ApiProduces('text/calendar')
  @ApiResponse({ status: 200, description: 'The iCalendar document.' })
  @ApiResponse({ status: 404, description: 'The authenticated user has no provider.' })
  async exportMine(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const ics = await this.calendar.exportMine(user.sub);
    // Set by hand AFTER the document exists, never by `@Header()`: these must
    // not ride on a 404 (same rule as the portfolio image route).
    res.setHeader('Content-Type', ICS_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="linkr-calendrier.ics"');
    res.setHeader('Cache-Control', 'private, no-store');
    return ics;
  }

  // NOT `@Public()`, like the reviews (decision of #80): the profile page that
  // reads it is private, and a public route with no caller is a surface nobody
  // watches. Opening it belongs to the « public discovery » chantier.
  @Get(':id/availability')
  @ApiOperation({
    summary:
      "A provider's availability over the coming days: published weekly hours and the FREE time left (blocked periods and timed appointments removed, booking lead time applied). Free time only — never why an hour is taken. 404 when the provider is not visible.",
  })
  @ApiResponse({ status: 200, type: ProviderAvailabilityDto })
  @ApiResponse({ status: 400, description: 'Malformed id or `days` out of bounds.' })
  @ApiResponse({ status: 404, description: 'Provider not visible.' })
  availability(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<ProviderAvailabilityDto> {
    return this.calendar.availability(id, query.days as number);
  }
}

/**
 * The iCal feed a calendar app polls. PUBLIC: Outlook or Google cannot send a
 * session, so the token in the path IS the credential (32 random bytes, stored
 * hashed). The web app relays it as `/calendrier/flux/{token}`; the API itself
 * is not reachable from the Internet (CLAUDE.md §11, D3).
 */
@ApiTags('calendar')
@UseGuards(RateLimitGuard)
@Controller('calendar')
export class CalendarFeedController {
  constructor(private readonly calendar: CalendarService) {}

  @Public()
  @Get('feed/:token')
  @RateLimit(FEED_READ_RATE_LIMIT)
  @ApiOperation({
    summary:
      'The iCal feed behind a subscription link. One 404 for every failure (malformed, unknown or revoked token, provider or account gone). No client name, title or address.',
  })
  @ApiProduces('text/calendar')
  @ApiResponse({ status: 200, description: 'The iCalendar document.' })
  @ApiResponse({ status: 404, description: 'No such feed.' })
  @ApiResponse({ status: 429, description: 'Too many reads from this address.' })
  async feed(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const ics = await this.calendar.feed(token);
    res.setHeader('Content-Type', ICS_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'inline; filename="linkr-calendrier.ics"');
    // The URL is a secret and the content is one person's schedule: nothing in
    // between may keep a copy.
    res.setHeader('Cache-Control', 'private, no-store');
    return ics;
  }
}
