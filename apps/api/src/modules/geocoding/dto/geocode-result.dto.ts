import { ApiProperty } from '@nestjs/swagger';
import { GeocodeCandidateDto } from './geocode-candidate.dto';

/**
 * Enveloped result for `GET /geocode`. Deliberately an envelope (not a bare
 * array): geocoding proposes a LIST of candidates, and an honest envelope from
 * day one avoids the "lying array annotation" bug hit by discover /
 * service-categories / provider-service-requests. Zero matches → `candidates: []`.
 */
export class GeocodeResultDto {
  @ApiProperty({
    type: GeocodeCandidateDto,
    isArray: true,
    description: 'Candidates for the query, best match first. Empty when none.',
  })
  candidates!: GeocodeCandidateDto[];
}
