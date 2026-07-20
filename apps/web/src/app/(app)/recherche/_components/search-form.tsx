'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Voie Ⓒ — the ONLY client surface of `/recherche` (Phase 3.14a).
 *
 * Coordinates are born in the browser (`navigator.geolocation`) and written INTO
 * the URL via `router.push`; the Server Component then reads `searchParams` + the
 * httpOnly access cookie and calls `discover`. There is NO BFF GET route handler
 * (rule held: BFF = mutations only). The URL is the decoupling joint where 3.14b
 * will graft address geocoding without touching this component.
 *
 * The client never fetches anything authenticated itself — the trade list is
 * passed in as props by the server (which owns the cookie).
 */

interface CategoryChoice {
  id: string;
  label: string;
}

export function SearchForm({
  categories,
  selectedCategoryId,
}: {
  categories: CategoryChoice[];
  selectedCategoryId?: string;
}) {
  const router = useRouter();
  // Initialise from the URL so the selector stays coherent after a search
  // re-render (the Server Component re-runs but this island keeps its instance).
  const [categoryId, setCategoryId] = useState(selectedCategoryId ?? '');
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState(false);

  const noCategory = categoryId === '';

  function locate() {
    // Belt-and-braces — the button is disabled without a category anyway.
    if (noCategory) return;
    setGeoError(false);

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError(true);
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const params = new URLSearchParams({
          categoryId,
          // Raw values — DevTools/Sensors gives exact coords; no toFixed so the
          // URL matches the sensor input (e.g. « lat=46.81 »).
          lat: String(position.coords.latitude),
          lng: String(position.coords.longitude),
        });
        // Reset before navigating: this island is preserved across the soft
        // navigation, so a lingering `locating` would freeze the button.
        setLocating(false);
        router.push(`/recherche?${params.toString()}`);
      },
      () => {
        // Refusal / timeout / position unavailable — all land in State E.
        setLocating(false);
        setGeoError(true);
      },
      { timeout: 10000, enableHighAccuracy: false },
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label
            htmlFor="category"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Métier
          </label>
          <select
            id="category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800"
          >
            <option value="">Choisir un métier</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:shrink-0">
          <button
            type="button"
            onClick={locate}
            disabled={noCategory || locating}
            className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {locating ? 'Localisation…' : 'Près de moi'}
          </button>
        </div>
      </div>

      {noCategory && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Choisissez d’abord un métier.
        </p>
      )}

      {geoError && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          {/* Do NOT promise address search — it does not exist until 3.14b. */}
          <p>Autorisez la géolocalisation pour trouver des prestataires près de vous.</p>
          <button
            type="button"
            onClick={locate}
            disabled={noCategory || locating}
            className="mt-2 font-medium underline underline-offset-2 hover:no-underline disabled:opacity-60"
          >
            Réessayer
          </button>
        </div>
      )}
    </div>
  );
}
