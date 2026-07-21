'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Voie Ⓒ′ — the ONLY client surface of `/recherche` (Phase 3.14a, extended in
 * 3.14b-front).
 *
 * The URL is the decoupling joint. This island has TWO writers on it, both
 * gated on a chosen trade (symmetry ①):
 *   - « Près de moi » → `navigator.geolocation` → push `?categoryId=&lat=&lng=`.
 *   - Address field   → submit → push `?categoryId=&q=` (geocode on the server).
 * There is NO BFF GET route handler and NO Server Action to read `/geocode`
 * (rule held: BFF = mutations only). The Server Component reads `searchParams` +
 * the httpOnly access cookie and calls `/geocode` / `discover` itself.
 *
 * Geocoding fires on SUBMISSION (button or Enter) — NOT on keystroke:
 * autocomplete-as-you-type is impossible under the URL joint (assumed trade-off
 * of Voie Ⓒ′).
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
  selectedAddress,
}: {
  categories: CategoryChoice[];
  selectedCategoryId?: string;
  selectedAddress?: string;
}) {
  const router = useRouter();
  // Initialise from the URL so the controls stay coherent after a search
  // re-render (the Server Component re-runs but this island keeps its instance).
  const [categoryId, setCategoryId] = useState(selectedCategoryId ?? '');
  const [address, setAddress] = useState(selectedAddress ?? '');
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState(false);

  const noCategory = categoryId === '';

  /**
   * Shared failure path for « Près de moi » (Phase 3.14b — État E debt SOLVED).
   * On refusal/timeout/unavailable, fall back to STATE 0 while KEEPING the trade
   * (`?categoryId=<id>`), THEN raise the banner — so no stale server results
   * (cards or candidates from a previous search) linger underneath it. The
   * banner is client state; it survives the soft navigation (island preserved).
   */
  function failGeo() {
    setLocating(false);
    router.push(`/recherche?${new URLSearchParams({ categoryId }).toString()}`);
    setGeoError(true);
  }

  function locate() {
    // Belt-and-braces — the button is disabled without a category anyway.
    if (noCategory) return;
    setGeoError(false);

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      failGeo();
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
      // Refusal / timeout / position unavailable — all land in State E.
      failGeo,
      { timeout: 10000, enableHighAccuracy: false },
    );
  }

  function submitAddress(e: React.FormEvent) {
    e.preventDefault();
    // Both gates: a trade must be chosen (symmetry ①), and a non-empty address.
    if (noCategory) return;
    const trimmed = address.trim();
    if (trimmed === '') return;
    // A successful address search clears any lingering geoloc banner.
    setGeoError(false);
    const params = new URLSearchParams({ q: trimmed, categoryId });
    router.push(`/recherche?${params.toString()}`);
  }

  const primaryButtonClass =
    'inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Trade — chosen FIRST; both location methods stay inert until it is. */}
      <div>
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

      {noCategory && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Choisissez d’abord un métier.
        </p>
      )}

      {/* Two location methods, both gated on a chosen trade (symmetry ①). */}
      <div className="mt-4 flex flex-col gap-3">
        <div>
          <button
            type="button"
            onClick={locate}
            disabled={noCategory || locating}
            className={primaryButtonClass}
          >
            {locating ? 'Localisation…' : 'Près de moi'}
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          ou
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </div>

        {/* Address method — submit fires geocoding; Enter in the field submits. */}
        <form onSubmit={submitAddress} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              htmlFor="address"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Adresse
            </label>
            <input
              id="address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={noCategory}
              placeholder="Ex. : 100 rue Sainte-Catherine, Montréal"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800"
            />
          </div>
          <div className="sm:shrink-0">
            <button type="submit" disabled={noCategory} className={primaryButtonClass}>
              Rechercher cette adresse
            </button>
          </div>
        </form>
      </div>

      {geoError && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          {/* The address field is now a visible alternative right above, so this
              stays focused on geolocation — no vaporware « address search » hint. */}
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
