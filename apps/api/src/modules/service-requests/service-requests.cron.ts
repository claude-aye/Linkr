import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ServiceRequestsService } from './service-requests.service';

@Injectable()
export class ServiceRequestsCron {
  private readonly logger = new Logger(ServiceRequestsCron.name);

  constructor(private readonly service: ServiceRequestsService) {}

  /** Every 5 minutes — expire OPEN requests whose deadline has passed. */
  @Cron('*/5 * * * *')
  async handleExpiry(): Promise<void> {
    this.logger.log('Running service request expiry check');
    const result = await this.service.runExpiryCheck();
    if (result.expired > 0) {
      this.logger.log(`Expiry check complete: ${result.expired} request(s) expired`);
    }
  }

  /**
   * Hourly — auto-release the 80% balance for COMPLETED, non-contested requests
   * whose release window (PLATFORM_AUTO_RELEASE_HOURS) elapsed. This only
   * TRIGGERS the capture (idempotent); the webhook finalizes status to PAID.
   */
  @Cron('0 * * * *')
  async handleAutoRelease(): Promise<void> {
    this.logger.log('Running balance auto-release check');
    const result = await this.service.runAutoReleaseCheck();
    if (result.released > 0 || result.failed > 0) {
      this.logger.log(
        `Auto-release check complete: ${result.released} triggered, ${result.failed} failed`,
      );
    }
  }
}
