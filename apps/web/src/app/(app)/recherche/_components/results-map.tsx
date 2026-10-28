'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import { useEffect, useRef } from 'react';
import {
  type ErrorEvent,
  type GeoJSONSource,
  Map as MapLibreMap,
  setWorkerUrl,
} from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';

import {
  boundsFor,
  type ProviderFeatureCollection,
  withMapTilerKey,
} from '@/lib/map/map-data';
import linkrLightStyle from '@/lib/map/linkr-light.style.json';

import { useResultsSync } from './results-sync';

/**
 * The results map of `/recherche` (R2b). Loaded ONLY through `ResultsMapSlot`
 * (`next/dynamic`, `ssr: false`), so neither this module nor `maplibre-gl` ever
 * reaches a state without results.
 *
 * Everything drawn is a NATIVE MapLibre layer (never an HTML marker):
 *   - provider pins from `approximateLocation` — a grid-cell centre, NEVER a
 *     base (CLAUDE.md §13.1 nº 22) — clustered, because providers of one cell
 *     share the very same coordinate;
 *   - a highlight ring for the active provider, from its own unclustered source
 *     so it shows even when the pin sits inside a cluster;
 *   - the searched point, a distinct dark dot.
 * A provider's service radius is NEVER drawn.
 *
 * The map is never the only way to reach a provider: the server-rendered list
 * next to it is complete and is the primary path, by keyboard as by pointer.
 */

/**
 * ⚠️ MapLibre 6 looks for its worker NEXT TO ITS OWN MODULE
 * (`new URL('./maplibre-gl-worker.mjs', import.meta.url)`). Once bundled, that
 * resolves to a file in `/_next/static/chunks/` that nobody emitted, and the map
 * fails with « Worker failed to load ». This reference makes the bundler emit
 * the (self-contained) worker file and gives MapLibre its real URL. Measured:
 * without it, every results page fell back to « Carte indisponible ».
 */
setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);

const ACCENT = '#6E1E2B';
const ON_ACCENT = '#F8F2EA';
const TEXT = '#2E211E';

const PROVIDERS = 'providers';
const ACTIVE = 'active-provider';
const SEARCHED = 'searched-point';

/** Desktop: the frosted panel covers the left of the map; frame around it. */
function framePadding(): { top: number; right: number; bottom: number; left: number } {
  const desktop = window.matchMedia('(min-width: 1024px)').matches;
  return desktop
    ? { top: 64, right: 64, bottom: 64, left: 64 + 448 }
    : { top: 40, right: 40, bottom: 56, left: 40 };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function ResultsMap({
  apiKey,
  providers,
  searched,
  onFail,
}: {
  apiKey: string;
  providers: ProviderFeatureCollection;
  searched: [number, number];
  onFail: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const sync = useResultsSync();
  // The latest callbacks, read from inside MapLibre handlers registered once.
  const syncRef = useRef(sync);
  const onFailRef = useRef(onFail);
  useEffect(() => {
    syncRef.current = sync;
    onFailRef.current = onFail;
  });

  // --- Create the map once per data set ------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      onFailRef.current();
    };

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        style: linkrLightStyle as unknown as StyleSpecification,
        center: searched,
        zoom: 11,
        // Light map, no tilting: a search map, not a 3-D viewer.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: { compact: false },
        // The key never lives in the versioned style: added here, and only to
        // `https://api.maptiler.com/…` requests.
        transformRequest: (url) => ({ url: withMapTilerKey(url, apiKey) }),
      });
    } catch {
      fail();
      return;
    }
    mapRef.current = map;

    // Registering an `error` listener also silences MapLibre's default
    // `console.error`: every failure below is handled, none is left unhandled.
    let loaded = false;
    map.on('error', (event: ErrorEvent) => {
      const status = (event.error as { status?: number } | undefined)?.status;
      // Before the first render, any error (style, TileJSON, glyphs) means no
      // usable map. Afterwards, only a refused key (401/403) does: a single
      // missing tile is not worth replacing the whole map.
      if (!loaded || status === 401 || status === 403) fail();
    });

    map.on('load', () => {
      loaded = true;

      map.addSource(PROVIDERS, {
        type: 'geojson',
        data: providers,
        cluster: true,
        clusterRadius: 36,
        clusterMaxZoom: 16,
      });
      map.addSource(ACTIVE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource(SEARCHED, {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: searched } },
      });

      map.addLayer({
        id: 'searched-point',
        type: 'circle',
        source: SEARCHED,
        paint: {
          'circle-radius': 6,
          'circle-color': TEXT,
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 3,
        },
      });
      map.addLayer({
        id: 'provider-clusters',
        type: 'circle',
        source: PROVIDERS,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ACCENT,
          'circle-radius': 16,
          'circle-stroke-color': ON_ACCENT,
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'provider-cluster-count',
        type: 'symbol',
        source: PROVIDERS,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 13,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': ON_ACCENT },
      });
      map.addLayer({
        id: 'provider-pins',
        type: 'circle',
        source: PROVIDERS,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ACCENT,
          'circle-radius': 9,
          'circle-stroke-color': ON_ACCENT,
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'provider-active',
        type: 'circle',
        source: ACTIVE,
        paint: {
          'circle-color': 'rgba(0,0,0,0)',
          'circle-radius': 20,
          'circle-stroke-color': ACCENT,
          'circle-stroke-width': 3,
        },
      });

      const bounds = boundsFor([
        searched,
        ...providers.features.map((f) => f.geometry.coordinates),
      ]);
      if (bounds) {
        map.fitBounds(
          [
            [bounds.west, bounds.south],
            [bounds.east, bounds.north],
          ],
          { padding: framePadding(), maxZoom: 14, animate: false },
        );
      }

      for (const layer of ['provider-pins', 'provider-clusters']) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
        });
      }

      // Pin → the matching card is highlighted and scrolled into view.
      map.on('click', 'provider-pins', (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === 'string') syncRef.current?.setActive(id, 'map');
      });

      // Group → zoom onto it. A group that cannot split (providers of one cell
      // share one coordinate) selects its first provider instead.
      map.on('click', 'provider-clusters', async (event) => {
        const feature = event.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        if (!feature || typeof clusterId !== 'number') return;
        const source = map.getSource(PROVIDERS) as GeoJSONSource | undefined;
        if (!source) return;
        try {
          const zoom = await source.getClusterExpansionZoom(clusterId);
          const center = (feature.geometry as unknown as { coordinates: [number, number] }).coordinates;
          if (zoom > map.getZoom() && zoom <= 16) {
            map.easeTo({ center, zoom, animate: !prefersReducedMotion() });
            return;
          }
          const leaves = await source.getClusterLeaves(clusterId, 1, 0);
          const id = leaves[0]?.properties?.id;
          if (typeof id === 'string') syncRef.current?.setActive(id, 'map');
        } catch {
          // A failed expansion leaves the map as it is; the list still works.
        }
      });
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [apiKey, providers, searched]);

  // --- Mirror the active provider onto the highlight ring --------------------
  const activeId = sync?.activeId ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource(ACTIVE) as GeoJSONSource | undefined;
      if (!source) return;
      const feature = providers.features.find((f) => f.id === activeId);
      source.setData({ type: 'FeatureCollection', features: feature ? [feature] : [] } as never);
    };
    if (map.isStyleLoaded() && map.getSource(ACTIVE)) apply();
    else map.once('load', apply);
  }, [activeId, providers]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Carte des prestataires trouvés (positions approximatives). La liste des résultats donne accès à chaque prestataire."
      className="h-full w-full"
    />
  );
}
