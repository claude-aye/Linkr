import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { CalendarController, CalendarFeedController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { ProviderCalendar } from './entities/provider-calendar.entity';
import { ProviderTimeOff } from './entities/provider-time-off.entity';
import { CalendarEventsRepository } from './repositories/calendar-events.repository';
import { ProviderCalendarRepository } from './repositories/provider-calendar.repository';

/**
 * Provider calendar. LEAF module: nothing imports it, so its imports cannot
 * create a cycle. `ServiceProvidersModule` for the provider reads
 * (`findByUserId` for `me`, `findById` for public visibility).
 *
 * ⚠️ IT DOES NOT IMPORT `ServiceRequestsModule`, ON PURPOSE. Appointments are
 * read from `service_requests` in raw SQL (`CalendarEventsRepository`), the
 * way `countActiveJobsForTrade` reads them from the providers side: one more
 * importer of that module would be one more edge to keep acyclic, for a read
 * that needs none of its services.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ProviderCalendar, ProviderTimeOff]),
    ServiceProvidersModule,
  ],
  controllers: [CalendarController, CalendarFeedController],
  providers: [
    ProviderCalendarRepository,
    CalendarEventsRepository,
    CalendarService,
    RateLimitGuard,
  ],
})
export class CalendarModule {}
