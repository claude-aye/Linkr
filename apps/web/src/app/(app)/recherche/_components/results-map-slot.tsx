'use client';

import dynamic from 'next/dynamic';
import { useState, useSyncExternalStore } from 'react';

import { mapFallbackReason, type ProviderFeatureCollection } from '@/lib/map/map-data';

/**
 * The map's place on the results screen (R2b). It decides BEFORE loading
 * anything whether a map can be drawn, and otherwise renders a sober frame:
 * the server-rendered list next to it is always complete, so the map is an
 * addition, never the only way to reach a provider.
 *
 * `maplibre-gl` (and its stylesheet) live in the dynamically imported chunk,
 * with `ssr: false`: they are fetched only when this slot actually mounts the
 * map, i.e. on a results state with a key and WebGL. Every other state of
 * `/recherche` never renders this component, so it never pays for the library.
 */

const ResultsMap = dynamic(() => import('./results-map'), {
  ssr: false,
  loading: () => <MapFrame busy />,
});

// Inlined at build time — a `NEXT_PUBLIC_*` value cannot be read at runtime.
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

// WebGL support does not change during a page's life: nothing to subscribe to.
const subscribeNever = () => () => {};

// Cached: the probe creates a context, which browsers limit in number.
let webglProbe: boolean | undefined;

function hasWebGL(): boolean {
  if (webglProbe !== undefined) return webglProbe;
  webglProbe = probeWebGL();
  return webglProbe;
}

function probeWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function MapFrame({ busy = false }: { busy?: boolean }) {
  return (
    <div
      aria-busy={busy || undefined}
      className="flex h-full w-full items-center justify-center bg-bg"
    >
      {busy ? null : (
        <p className="rounded-2xl border border-on-accent/70 bg-surface px-5 py-4 text-sm text-text-muted">
          Carte indisponible. Les résultats restent dans la liste.
        </p>
      )}
    </div>
  );
}

export function ResultsMapSlot({
  providers,
  searched,
}: {
  providers: ProviderFeatureCollection;
  /** The searched point, `[lng, lat]`. */
  searched: [number, number];
}) {
  // WebGL can only be probed in the browser. `useSyncExternalStore` with a
  // `null` server snapshot keeps the server HTML and the first client render
  // identical (the busy frame), then switches once the browser answers — no
  // hydration mismatch, and no `setState` in an effect.
  const webgl = useSyncExternalStore(subscribeNever, hasWebGL, () => null);
  const [failed, setFailed] = useState(false);

  if (webgl === null && !failed) return <MapFrame busy />;
  const reason = failed ? 'load-error' : mapFallbackReason(MAPTILER_KEY, webgl === true);
  if (reason !== null || !MAPTILER_KEY) return <MapFrame />;

  return (
    <ResultsMap
      apiKey={MAPTILER_KEY}
      providers={providers}
      searched={searched}
      onFail={() => setFailed(true)}
    />
  );
}
