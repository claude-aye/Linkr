import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { ServicesCatalogModule } from '../services-catalog/services-catalog.module';
import { UsersModule } from '../users/users.module';
import { AdminDemandSignalsController } from './admin-demand-signals.controller';
import { DemandSignalsController } from './demand-signals.controller';
import { DemandSignalsService } from './demand-signals.service';
import { DemandSignal } from './entities/demand-signal.entity';
import { DemandSignalsRepository } from './repositories/demand-signals.repository';

/**
 * Leaf module — nothing imports it, so the two domain imports cannot create a
 * cycle. `ServiceProvidersModule` is already a sink in this codebase (notifications,
 * payments and quotes import it the same way) and it exports the repository whose
 * eligibility predicate re-verifies the zero claim; `ServicesCatalogModule`
 * exports the category repository that rejects an unknown trade. `UsersModule`
 * exports the repository `AdminGuard` reads the caller's system role from — the
 * same import every admin-guarded module already makes (verifications, payments,
 * quotes, services-catalog), and the guard is registered as a module-local
 * provider here for the same reason.
 *
 * Nothing is exported: the demand map has one writer and one reader, and both
 * are this module's own controllers.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DemandSignal]),
    ServicesCatalogModule,
    ServiceProvidersModule,
    UsersModule,
  ],
  controllers: [DemandSignalsController, AdminDemandSignalsController],
  providers: [DemandSignalsRepository, DemandSignalsService, AdminGuard],
})
export class DemandSignalsModule {}
