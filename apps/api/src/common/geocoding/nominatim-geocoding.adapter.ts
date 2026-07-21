import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeocodeCandidate, IGeocodingService } from './geocoding.interface';

/** Shape of a single Nominatim `/search` result (only the fields we read). */
interface NominatimSearchResult {
  display_name?: string;
  lat?: string;
  lon?: string;
}

/**
 * Adapter over Nominatim (OpenStreetMap) forward geocoding. Free, keyless.
 *
 * Nominatim quirks handled here:
 * - it returns `lon` (not `lng`) and lat/lon as **strings** → we parseFloat and
 *   map `lon → lng` so candidates match the WGS84-decimal contract discover uses;
 * - its ToS **requires** a descriptive `User-Agent` (missing → requests blocked).
 */
@Injectable()
export class NominatimGeocodingAdapter implements IGeocodingService {
  private readonly logger = new Logger(NominatimGeocodingAdapter.name);
  private readonly baseUrl: string;
  private readonly userAgent: string;

  /** Upper bound on the outbound request so a slow provider never hangs ours. */
  private static readonly REQUEST_TIMEOUT_MS = 5000;

  constructor(private readonly configService: ConfigService) {
    // Trim a trailing slash so `${base}/search` never doubles up.
    this.baseUrl = this.configService
      .getOrThrow<string>('NOMINATIM_BASE_URL')
      .replace(/\/+$/, '');
    this.userAgent =
      this.configService.getOrThrow<string>('NOMINATIM_USER_AGENT');
  }

  async geocode(query: string, limit: number): Promise<GeocodeCandidate[]> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(limit));
    // Bias to Canada and return French labels (Quebec-first).
    url.searchParams.set('countrycodes', 'ca');
    url.searchParams.set('accept-language', 'fr-CA');

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept-Language': 'fr-CA',
        },
        signal: AbortSignal.timeout(
          NominatimGeocodingAdapter.REQUEST_TIMEOUT_MS,
        ),
      });
    } catch (err) {
      // Network failure or timeout — never leak the cause to the client.
      this.logger.error(`Nominatim request failed: ${String(err)}`);
      throw this.unavailable();
    }

    if (!response.ok) {
      this.logger.error(`Nominatim responded with HTTP ${response.status}`);
      throw this.unavailable();
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      this.logger.error(`Nominatim returned a non-JSON body: ${String(err)}`);
      throw this.unavailable();
    }

    if (!Array.isArray(payload)) {
      this.logger.error('Nominatim returned a non-array payload');
      throw this.unavailable();
    }

    return payload
      .map((raw) => this.toCandidate(raw as NominatimSearchResult))
      .filter((candidate): candidate is GeocodeCandidate => candidate !== null);
  }

  /** Maps one Nominatim result to a candidate, or null if unusable. */
  private toCandidate(raw: NominatimSearchResult): GeocodeCandidate | null {
    const label = raw.display_name;
    const lat = parseFloat(raw.lat ?? '');
    const lng = parseFloat(raw.lon ?? ''); // Nominatim `lon` → our `lng`.
    if (typeof label !== 'string' || label.length === 0) {
      return null;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    return { label, lat, lng };
  }

  /** 502 with a vouvoyé, provider-agnostic message. */
  private unavailable(): BadGatewayException {
    return new BadGatewayException(
      "La recherche d'adresse est momentanément indisponible. Veuillez réessayer.",
    );
  }
}
