import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QuotesService } from './quotes.service';

@Injectable()
export class QuotesCron {
  private readonly logger = new Logger(QuotesCron.name);

  constructor(private readonly service: QuotesService) {}

  /** Hourly — expire SUBMITTED quotes whose valid_until_utc has passed. */
  @Cron('0 * * * *')
  async handleExpiry(): Promise<void> {
    this.logger.log('Running quote expiry check');
    const result = await this.service.runExpiryCheck();
    if (result.expired > 0) {
      this.logger.log(`Quote expiry check complete: ${result.expired} quote(s) expired`);
    }
  }
}
