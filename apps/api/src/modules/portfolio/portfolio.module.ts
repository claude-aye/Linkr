import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { UsersModule } from '../users/users.module';
import { AdminPortfolioController } from './admin-portfolio.controller';
import { PortfolioItem } from './entities/portfolio-item.entity';
import { PortfolioController, PortfolioImageController } from './portfolio.controller';
import { PortfolioImageProcessor } from './portfolio-image.processor';
import { PortfolioService } from './portfolio.service';
import { PortfolioItemRepository } from './repositories/portfolio-item.repository';

/**
 * Provider portfolio (P1). Leaf module: nothing imports it, so its imports
 * cannot create a cycle. `ServiceProvidersModule` for the provider reads
 * (`findByUserId` for `me`, `findById` for public visibility), `UsersModule`
 * for `AdminGuard` (registered as a module-local provider, the codebase's
 * convention). Storage comes from the global `StorageModule`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PortfolioItem]),
    ServiceProvidersModule,
    UsersModule,
  ],
  controllers: [PortfolioController, PortfolioImageController, AdminPortfolioController],
  providers: [
    PortfolioItemRepository,
    PortfolioImageProcessor,
    PortfolioService,
    AdminGuard,
  ],
})
export class PortfolioModule {}
