import {
  Body,
  Controller,
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
import { CreateRefundDto } from './dto/create-refund.dto';
import { RefundResponseDto } from './dto/refund-response.dto';
import { RefundsService } from './refunds.service';

@ApiTags('payments')
@UseGuards(AdminGuard)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Post(':id/refund')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Refund a payment (ADMIN only). Supports partial refunds; pro-rata fee reversal applied automatically. Final settlement via the Stripe webhook.',
  })
  @ApiResponse({ status: 201, type: RefundResponseDto })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  @ApiResponse({
    status: 422,
    description: 'Payment not refundable or amount exceeds the refundable balance',
  })
  @ApiResponse({ status: 502, description: 'Stripe rejected the refund' })
  refund(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRefundDto,
  ): Promise<RefundResponseDto> {
    return this.refundsService.refundPayment(id, dto, user.sub);
  }
}
