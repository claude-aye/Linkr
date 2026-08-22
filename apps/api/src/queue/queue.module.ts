import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  EMAIL_JOB_OPTIONS,
  EMAIL_QUEUE,
  STRIPE_WEBHOOKS_JOB_OPTIONS,
  STRIPE_WEBHOOKS_QUEUE,
} from './queue.constants';

/**
 * Central registration of the application's BullMQ queues. The Redis connection
 * itself is configured once via `BullModule.forRootAsync` in AppModule; this
 * module registers named queues and re-exports BullModule so feature modules can
 * inject the queue (producers) or bind processors (consumers).
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: STRIPE_WEBHOOKS_QUEUE,
      defaultJobOptions: STRIPE_WEBHOOKS_JOB_OPTIONS,
    }),
    BullModule.registerQueue({
      name: EMAIL_QUEUE,
      defaultJobOptions: EMAIL_JOB_OPTIONS,
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
