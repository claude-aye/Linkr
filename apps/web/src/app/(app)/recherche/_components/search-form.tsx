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
  embedded = false,
}: {
  categories: CategoryChoice[];
  selectedCategoryId?: string;
  selectedAddress?: string;
  /**
   * R2b: in the results-with-map layout the form sits INSIDE the frosted side
   * panel, which is then the screen's one `backdrop-filter`. Embedded, the form
   * drops its own frosted shell so the screen never carries two.
   */
  embedded?: boolean;
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

  // Direction A (R1). One radius on the whole screen (`rounded-2xl`), a 44px
  // floor on everything clickable (`min-h-11`), and a visible bordeaux focus
  // ring. « Près de moi » is the one filled action; the address submit is the
  // secondary outline — the two are equal alternatives, and the accent fills
  // one control only.
  const focusRing =
    'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
  const buttonBase = `inline-flex min-h-11 w-full items-center justify-center rounded-2xl px-5 text-sm font-medium transition motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${focusRing}`;
  const primaryButtonClass = `${buttonBase} bg-accent text-on-accent hover:bg-accent/90`;
  const secondaryButtonClass = `${buttonBase} border border-accent/40 text-accent hover:bg-accent/10`;
  const fieldClass =
    'mt-1 min-h-11 w-full rounded-2xl border border-text/20 bg-bg/60 px-4 text-base text-text outline-none transition motion-reduce:transition-none placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50';
  const labelClass = 'block text-sm font-medium text-text';

  return (
    // The screen's ONE frosted layer (`backdrop-blur`). Nothing else on
    // `/recherche` may carry a `backdrop-filter`: the result cards scroll, and a
    // blur on a scrolling list costs every frame on a phone. Embedded in the
    // map layout's side panel (R2b), the panel carries it instead.
    <div
      className={
        embedded
          ? ''
          : 'rounded-2xl border border-on-accent/70 bg-surface p-5 shadow-xl shadow-accent/10 backdrop-blur-xl sm:p-6'
      }
    >
      {/* Trade — chosen FIRST; both location methods stay inert until it is. */}
      <div>
        <label
          htmlFor="category"
          className={labelClass}
        >
          Métier
        </label>
        <select
          id="category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={fieldClass}
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
        <p className="mt-2 text-xs text-text-muted">
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

        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span className="h-px flex-1 bg-text/15" />
          ou
          <span className="h-px flex-1 bg-text/15" />
        </div>

        {/* Address method — submit fires geocoding; Enter in the field submits. */}
        {/* Embedded in the ~450px side panel, the field and its button stay
            stacked: side by side, the field would shrink to a few characters. */}
        <form
          onSubmit={submitAddress}
          className={embedded ? 'flex flex-col gap-2' : 'flex flex-col gap-2 sm:flex-row sm:items-end'}
        >
          <div className="flex-1">
            <label
              htmlFor="address"
              className={labelClass}
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
              className={fieldClass}
            />
          </div>
          <div className="sm:shrink-0">
            <button type="submit" disabled={noCategory} className={secondaryButtonClass}>
              Rechercher cette adresse
            </button>
          </div>
        </form>
      </div>

      {geoError && (
        <div
          role="alert"
          // State colour (amber warning) kept on purpose until the state
          // colours get their own tokens (CLAUDE.md §6); its dark variants
          // are gone with the rest.
          className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
        >
          {/* The address field is now a visible alternative right above, so this
              stays focused on geolocation — no vaporware « address search » hint. */}
          <p>Autorisez la géolocalisation pour trouver des prestataires près de vous.</p>
          <button
            type="button"
            onClick={locate}
            disabled={noCategory || locating}
            className={`mt-1 inline-flex min-h-11 items-center rounded-2xl font-medium underline underline-offset-2 hover:no-underline disabled:opacity-60 ${focusRing}`}
          >
            Réessayer
          </button>
        </div>
      )}
    </div>
  );
}
