import { Module } from '@nestjs/common';
// The seam lives in common/geocoding; alias it locally so this feature module
// can keep the canonical `GeocodingModule` name without a class-name clash.
import { GeocodingModule as GeocodingSeamModule } from '../../common/geocoding/geocoding.module';
import { GeocodingController } from './geocoding.controller';

/**
 * Thin feature module for `GET /geocode`. Imports the geocoding seam (which
 * provides GEOCODING_SERVICE) and exposes the controller. Leaf module — no
 * domain dependencies, no cycles.
 */
@Module({
  imports: [GeocodingSeamModule],
  controllers: [GeocodingController],
})
export class GeocodingModule {}
