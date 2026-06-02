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
}
