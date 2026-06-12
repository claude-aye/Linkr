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
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaymentMethodsService } from './payment-methods.service';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { PaymentMethodResponseDto } from './dto/payment-method-response.dto';

/**
 * User-owned payment methods. Authenticated by the global JwtAuthGuard; a user
 * manages only their own methods (403 otherwise). Org-owned methods are
 * deferred to the B2B subscription phase.
 */
@ApiTags('payment-methods')
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Save a Stripe payment method for the current user. Creates the Stripe Customer on first use; the first method saved becomes the default.',
  })
  @ApiResponse({ status: 201, type: PaymentMethodResponseDto })
  @ApiResponse({ status: 409, description: 'This payment method is already saved' })
  @ApiResponse({ status: 422, description: 'Unsupported payment method type' })
  @ApiResponse({ status: 502, description: 'Stripe API call failed' })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return this.service.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the current user's saved payment methods." })
  @ApiResponse({ status: 200, type: [PaymentMethodResponseDto] })
  list(@CurrentUser() user: JwtPayload): Promise<PaymentMethodResponseDto[]> {
    return this.service.list(user.sub);
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Make a saved method the default (unsets the previous default).',
  })
  @ApiResponse({ status: 200, type: PaymentMethodResponseDto })
  @ApiResponse({ status: 403, description: 'You do not own this payment method' })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  setDefault(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentMethodResponseDto> {
    return this.service.setDefault(user.sub, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a saved method (soft-delete + best-effort Stripe detach).',
  })
  @ApiResponse({ status: 200, type: PaymentMethodResponseDto })
  @ApiResponse({ status: 403, description: 'You do not own this payment method' })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentMethodResponseDto> {
    return this.service.remove(user.sub, id);
  }
}
