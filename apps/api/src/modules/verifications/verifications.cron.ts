import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VerificationsService } from './verifications.service';

/**
 * Nightly license-expiry job (CLAUDE.md §9.4). Delegates to the same handler
 * exposed by the manual admin trigger so behaviour stays identical.
 */
@Injectable()
export class VerificationsCron {
  private readonly logger = new Logger(VerificationsCron.name);

  constructor(private readonly verificationsService: VerificationsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleLicenseExpiry(): Promise<void> {
    this.logger.log('Running nightly license expiry check');
    const result = await this.verificationsService.runLicenseExpiryCheck();
    this.logger.log(
      `Nightly expiry check complete: ${result.documentsExpired} expired, ${result.categoriesDowngraded} downgraded`,
    );
  }
}
