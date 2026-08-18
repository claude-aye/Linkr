import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { ServicesCatalogModule } from '../services-catalog/services-catalog.module';
import { DemandSignalsController } from './demand-signals.controller';
import { DemandSignalsService } from './demand-signals.service';
import { DemandSignal } from './entities/demand-signal.entity';
import { DemandSignalsRepository } from './repositories/demand-signals.repository';

/**
 * Leaf module — nothing imports it, so the two domain imports cannot create a
 * cycle. `ServiceProvidersModule` is already a sink in this codebase (notifications,
 * payments and quotes import it the same way) and it exports the repository whose
 * eligibility predicate re-verifies the zero claim; `ServicesCatalogModule`
 * exports the category repository that rejects an unknown trade.
 *
 * Nothing is exported: the demand map has one writer, and it is this module's own
 * controller.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DemandSignal]),
    ServicesCatalogModule,
    ServiceProvidersModule,
  ],
  controllers: [DemandSignalsController],
  providers: [DemandSignalsRepository, DemandSignalsService],
})
export class DemandSignalsModule {}
