import { Logger, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisModule } from '../redis/redis.module';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { CachedGeocodingService } from './cached-geocoding.service';
import { GEOCODING_SERVICE, IGeocodingService } from './geocoding.interface';
import { NominatimGeocodingAdapter } from './nominatim-geocoding.adapter';

const geocodingProvider: Provider = {
  provide: GEOCODING_SERVICE,
  inject: [ConfigService, REDIS_CLIENT],
  useFactory: (
    configService: ConfigService,
    redis: Redis,
  ): IGeocodingService => {
    const provider = configService.get<string>(
      'GEOCODING_PROVIDER',
      'nominatim',
    );
    const logger = new Logger('GeocodingModule');
    if (provider === 'nominatim') {
      logger.log('Using Nominatim geocoding adapter (Redis-cached)');
      // The cache wraps the adapter here, at the composition root, so no token
      // is needed for the concrete adapter and the controller is untouched.
      return new CachedGeocodingService(
        new NominatimGeocodingAdapter(configService),
        redis,
      );
    }
    // Fail fast on an unknown provider — mirrors STORAGE_DRIVER's strict boot.
    // (Env validation already rejects unknown values; this is a second guard
    // for future adapters wired here before their env value is whitelisted.)
    throw new Error(`Unsupported GEOCODING_PROVIDER: "${provider}"`);
  },
};

/**
 * Geocoding seam — mirrors common/storage. Selects the adapter by
 * GEOCODING_PROVIDER and exports the GEOCODING_SERVICE port.
 *
 * Non-global (unlike StorageModule): its only consumer is the geocoding feature
 * module, which imports this seam explicitly. Storage is @Global because it is
 * injected by a module that never imports it; geocoding has a single, local
 * consumer, so an explicit import is the tighter wiring.
 */
@Module({
  imports: [RedisModule],
  providers: [geocodingProvider],
  exports: [GEOCODING_SERVICE],
})
export class GeocodingModule {}
