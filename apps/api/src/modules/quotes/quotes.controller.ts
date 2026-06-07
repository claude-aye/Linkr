import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { SubmitQuoteDto } from './dto/submit-quote.dto';
import { QuoteResponseDto } from './dto/quote-response.dto';
import { QuotesService } from './quotes.service';

@ApiTags('quotes')
@Controller()
export class QuotesController {
  constructor(private readonly service: QuotesService) {}

  @Post('service-requests/:id/quotes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Submit a quote on an OPEN PROJECT_TENDER. Caller must own an individual ' +
      'provider profile eligible (VERIFIED/NOT_REQUIRED) for the request category.',
  })
  @ApiResponse({ status: 201, type: QuoteResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error or validUntilUtc not in the future' })
  @ApiResponse({ status: 403, description: 'No individual provider profile, or not eligible for the category' })
  @ApiResponse({ status: 404, description: 'Service request not found' })
  @ApiResponse({ status: 409, description: 'Request not an OPEN tender, or an active quote already exists' })
  submit(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitQuoteDto,
  ): Promise<QuoteResponseDto> {
    return this.service.submit(id, user.sub, dto);
  }

  @Get('service-requests/:id/quotes')
  @ApiOperation({
    summary:
      'List quotes for a request. The request owner sees all quotes; a provider sees only their own.',
  })
  @ApiResponse({ status: 200, type: QuoteResponseDto, isArray: true })
  @ApiResponse({ status: 404, description: 'Service request not found' })
  listForRequest(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuoteResponseDto[]> {
    return this.service.listForRequest(id, user.sub);
  }

  @Get('quotes/mine')
  @ApiOperation({ summary: "List the caller's own quotes (as a provider)." })
  @ApiResponse({ status: 200, type: QuoteResponseDto, isArray: true })
  listMine(@CurrentUser() user: JwtPayload): Promise<QuoteResponseDto[]> {
    return this.service.listMine(user.sub);
  }

  @Post('quotes/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Withdraw your own SUBMITTED quote (provider only).',
  })
  @ApiResponse({ status: 200, type: QuoteResponseDto })
  @ApiResponse({ status: 403, description: 'Caller does not own this quote' })
  @ApiResponse({ status: 404, description: 'Quote not found' })
  @ApiResponse({ status: 409, description: 'Quote is not in a withdrawable state' })
  withdraw(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuoteResponseDto> {
    return this.service.withdraw(id, user.sub);
  }

  @Post('quotes/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Accept a quote (request owner only). Transitions the request OPEN→ASSIGNED, ' +
      'rejects sibling quotes and self-assigns the INDIVIDUAL provider.',
  })
  @ApiResponse({ status: 200, type: QuoteResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not the request owner' })
  @ApiResponse({ status: 404, description: 'Quote, request or provider not found' })
  @ApiResponse({ status: 409, description: 'Request not OPEN, quote not SUBMITTED, or quote expired' })
  @ApiResponse({ status: 501, description: 'Accepting an ORGANIZATION provider quote is not yet implemented' })
  accept(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuoteResponseDto> {
    return this.service.accept(id, user.sub);
  }

  @Post('admin/quotes/run-expiry-check')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Manually trigger the SUBMITTED→EXPIRED quote sweep (same logic as the hourly cron). ADMIN only.',
  })
  @ApiResponse({ status: 200, description: 'Number of quotes expired' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  runExpiryCheck(): Promise<{ expired: number }> {
    return this.service.runExpiryCheck();
  }
}
