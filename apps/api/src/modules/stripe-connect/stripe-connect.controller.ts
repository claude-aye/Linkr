import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { StripeConnectService } from './stripe-connect.service';
import { ConnectOnboardingResponseDto } from './dto/connect-onboarding-response.dto';
import { ConnectAccountResponseDto } from './dto/connect-account-response.dto';

/**
 * Provider-facing Stripe Connect endpoints. Authenticated by the global
 * JwtAuthGuard; ownership of the INDIVIDUAL provider is enforced in the service.
 */
@ApiTags('stripe-connect')
@Controller('service-providers')
export class StripeConnectController {
  constructor(private readonly service: StripeConnectService) {}

  @Post(':id/connect/onboard')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Start/resume Stripe Connect (Express) onboarding for an INDIVIDUAL provider you own. ' +
      'Creates the account on first call and returns a single-use Account Link.',
  })
  @ApiResponse({ status: 201, type: ConnectOnboardingResponseDto })
  @ApiResponse({ status: 403, description: 'You do not own this provider' })
  @ApiResponse({ status: 404, description: 'Service provider not found' })
  @ApiResponse({ status: 501, description: 'ORGANIZATION provider onboarding is not implemented' })
  @ApiResponse({ status: 502, description: 'Stripe API call failed (e.g. platform profile incomplete)' })
  onboard(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConnectOnboardingResponseDto> {
    return this.service.onboard(id, user);
  }

  @Get(':id/connect/status')
  @ApiOperation({
    summary:
      'Get the local Stripe Connect mirror (onboarding status, capabilities, outstanding requirements) for an owned provider.',
  })
  @ApiResponse({ status: 200, type: ConnectAccountResponseDto })
  @ApiResponse({ status: 403, description: 'You do not own this provider' })
  @ApiResponse({ status: 404, description: 'Provider not found, or no Connect account yet' })
  @ApiResponse({ status: 501, description: 'ORGANIZATION provider onboarding is not implemented' })
  getStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConnectAccountResponseDto> {
    return this.service.getStatus(id, user);
  }

  @Post(':id/connect/refresh-link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Regenerate an Account Link for an owned provider whose Connect account already exists ' +
      '(e.g. after the previous link expired).',
  })
  @ApiResponse({ status: 200, type: ConnectOnboardingResponseDto })
  @ApiResponse({ status: 403, description: 'You do not own this provider' })
  @ApiResponse({ status: 404, description: 'Provider not found, or no Connect account yet' })
  @ApiResponse({ status: 501, description: 'ORGANIZATION provider onboarding is not implemented' })
  @ApiResponse({ status: 502, description: 'Stripe API call failed' })
  refreshLink(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConnectOnboardingResponseDto> {
    return this.service.refreshLink(id, user);
  }
}
