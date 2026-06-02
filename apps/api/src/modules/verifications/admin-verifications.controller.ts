import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RejectVerificationDocumentDto } from './dto/reject-verification-document.dto';
import { VerificationDocumentResponseDto } from './dto/verification-document-response.dto';
import { VerificationDocumentReviewStatus } from './enums/verification-document-review-status.enum';
import { VerificationsService } from './verifications.service';

@ApiTags('verifications')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminVerificationsController {
  constructor(private readonly verificationsService: VerificationsService) {}

  @Get('verification-documents')
  @ApiOperation({ summary: 'Admin review queue, filtered by review status (default PENDING).' })
  @ApiQuery({
    name: 'status',
    enum: VerificationDocumentReviewStatus,
    required: false,
  })
  listQueue(
    @Query('status') status?: VerificationDocumentReviewStatus,
  ): Promise<VerificationDocumentResponseDto[]> {
    return this.verificationsService.listByStatus(
      status ?? VerificationDocumentReviewStatus.PENDING,
    );
  }

  @Post('verification-documents/:id/approve')
  @ApiOperation({
    summary:
      'Approve a document. Triggers the auto VERIFIED cascade when all required documents are covered.',
  })
  approve(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VerificationDocumentResponseDto> {
    return this.verificationsService.approveDocument(user.sub, id);
  }

  @Post('verification-documents/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a document with a reason (does not downgrade the PSC).' })
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectVerificationDocumentDto,
  ): Promise<VerificationDocumentResponseDto> {
    return this.verificationsService.rejectDocument(
      user.sub,
      id,
      dto.rejectionReason,
    );
  }

  @Post('verifications/run-expiry-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Manually trigger the license expiry check (same logic as the nightly cron).',
  })
  runExpiryCheck(): Promise<{
    documentsExpired: number;
    categoriesDowngraded: number;
  }> {
    return this.verificationsService.runLicenseExpiryCheck();
  }
}
