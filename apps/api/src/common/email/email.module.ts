import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { RedisModule } from '../redis/redis.module';
import { EmailBudgetService } from './email-budget.service';
import { EmailProcessor } from './email.processor';
import { EmailService } from './email.service';
import { EMAIL_SENDER } from './senders/email-sender.interface';
import { SmtpEmailSender } from './senders/smtp.sender';

/**
 * Outbound email: the producer (EmailService), the consumer (EmailProcessor),
 * and the transport bound to the EMAIL_SENDER port.
 *
 * `useClass`, not a `useFactory` that selects — unlike StorageModule and
 * GeocodingModule there is nothing to select here: SMTP is the transport, and
 * a factory pretending otherwise would advertise a choice that does not exist.
 * The port stays, so a second transport later is a real adapter swap.
 *
 * Non-global, like GeocodingModule: consumers import it explicitly, and A-2
 * will be the first.
 */
@Module({
  imports: [QueueModule, RedisModule],
  providers: [
    { provide: EMAIL_SENDER, useClass: SmtpEmailSender },
    EmailBudgetService,
    EmailService,
    EmailProcessor,
  ],
  exports: [EmailService],
})
export class EmailModule {}
