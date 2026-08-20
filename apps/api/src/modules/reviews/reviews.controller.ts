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
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateReviewDto } from './dto/create-review.dto';
import { MyReviewListDto } from './dto/my-review-list.dto';
import { RespondToReviewDto } from './dto/respond-to-review.dto';
import { ReviewResponseDto } from './dto/review-response.dto';
import { ReviewsService } from './reviews.service';

/**
 * How many reviews one caller may write per window.
 *
 * ⚠️ THE SECOND USER OF `common/rate-limit/` (session 8), and the point of
 * having written it as a reusable guard rather than bolting a counter onto one
 * route: adding it here costs one decorator and one provider.
 *
 * The figures: writing a review requires a distinct COMPLETED request each time,
 * so honest traffic is a handful in a lifetime, not per hour — even a client
 * catching up on several finished jobs in one sitting lands in low single
 * digits. Ten per hour is several times that, invisible to real use, and it caps
 * hammering the endpoint with rejected attempts (the guard counts attempts, not
 * successes) without ever standing between a client and the review they meant to
 * write.
 *
 * Constants rather than environment variables, deliberately — same reasoning as
 * `POST /demand-signals`: these describe the shape of this route's honest
 * traffic, not a per-deployment tuning knob.
 */
const REVIEW_LIMIT = 10;
const REVIEW_WINDOW_SECONDS = 60 * 60;

/**
 * Same budget for the provider's replies, and for the same reason: honest
 * traffic is bounded by how many unanswered reviews the caller actually owns,
 * so ten an hour is far above real use while still capping someone hammering
 * the route with rejected attempts (the guard counts attempts, not successes).
 */
const RESPONSE_LIMIT = 10;
const RESPONSE_WINDOW_SECONDS = 60 * 60;

@ApiTags('reviews')
@UseGuards(RateLimitGuard)
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Post()
  @RateLimit({ limit: REVIEW_LIMIT, windowSeconds: REVIEW_WINDOW_SECONDS })
  @ApiOperation({
    summary:
      "Write the client's review of a COMPLETED request. The reviewed provider and the author are resolved server-side from the request — neither is accepted from the body — which is what makes a review unfalsifiable (D-1).",
  })
  @ApiResponse({ status: 201, type: ReviewResponseDto })
  @ApiResponse({ status: 400, description: 'Malformed body, or a fractional rating.' })
  @ApiResponse({ status: 403, description: 'The caller is not the client of this request.' })
  @ApiResponse({ status: 404, description: 'Unknown service request.' })
  @ApiResponse({
    status: 409,
    description:
      'The request is not COMPLETED, or it already carries a live review. The second case is a door, not a wall: delete the existing review and write a new one (D-3).',
  })
  @ApiResponse({
    status: 429,
    description: 'The caller spent its budget for the current window. Carries `Retry-After`.',
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    return this.service.create(user.sub, dto);
  }

  /**
   * ⚠️ DECLARED BEFORE `@Delete(':id')` IS IRRELEVANT — but declaring a literal
   * `mine` segment next to a `:id` route is not: on a `@Get`, `mine` would be
   * captured as an `:id` if one existed. There is no `GET /reviews/:id` today,
   * and if one is ever added it MUST come after this. Same trap as
   * `GET /service-providers/me`.
   */
  @Get('mine')
  @ApiOperation({
    summary:
      "The caller's own live reviews. Exists so that « see » and « retract » survive a page reload: the public item carries neither the request id nor an author id, so nothing else lets a client recognise their own review.",
  })
  @ApiResponse({ status: 200, type: MyReviewListDto })
  listMine(@CurrentUser() user: JwtPayload): Promise<MyReviewListDto> {
    return this.service.listMine(user.sub);
  }

  /**
   * The provider's single reply (D-2).
   *
   * A POST rather than a PATCH: this CREATES the one reply a review may carry,
   * and it is not an update — there is nothing to update afterwards, ever. The
   * 409 below is a WALL, unlike the client's « already reviewed » 409, which is
   * a door: the provider cannot edit or remove their reply, and the only thing
   * that frees the slot is the client retracting the review (which takes the
   * reply with it, D-3).
   */
  @Post(':id/response')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: RESPONSE_LIMIT, windowSeconds: RESPONSE_WINDOW_SECONDS })
  @ApiOperation({
    summary:
      "Answer a review of one's own provider profile — once (D-2). The reply is published where the review is read; it cannot be edited or removed, and the client does not answer back.",
  })
  @ApiResponse({ status: 204, description: 'Reply published.' })
  @ApiResponse({ status: 400, description: 'Missing or blank reply.' })
  @ApiResponse({
    status: 403,
    description: 'The caller does not manage the provider this review is about.',
  })
  @ApiResponse({ status: 404, description: 'Unknown or retracted review.' })
  @ApiResponse({
    status: 409,
    description:
      'This review already carries a reply. Unlike the client\'s 409 this is final — a reply is written once and never changed.',
  })
  @ApiResponse({
    status: 429,
    description: 'The caller spent its budget for the current window. Carries `Retry-After`.',
  })
  respond(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondToReviewDto,
  ): Promise<void> {
    return this.service.respondToReview(user.sub, id, dto);
  }

  /**
   * ⚠️ SHIPPED IN THE SAME PR AS THE WRITE, NEVER AFTER IT. The partial unique
   * index makes "one live review per request" true; this is the only thing that
   * frees the slot, and it is also the author's right of retraction. Shipping
   * the write alone would open a window in which the index is the session-4
   * dead end and no client can retract anything.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Retract one's own review (soft delete). Takes the provider's reply with it, and frees the request's review slot (D-3).",
  })
  @ApiResponse({ status: 204, description: 'Review retracted.' })
  @ApiResponse({
    status: 404,
    description:
      "Unknown, already retracted, or not the caller's review — deliberately one answer, so a 403 cannot confirm that an id belongs to someone else.",
  })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(user.sub, id);
  }
}
