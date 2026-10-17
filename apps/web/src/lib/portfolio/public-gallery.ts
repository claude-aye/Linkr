/**
 * The public gallery of a provider's profile — « Réalisations » (P3).
 *
 * Every decision the section and its viewer make lives here, so that
 * `node --test` can pin them: whether the section shows at all, its title, the
 * `alt` of a photo, which thumbnails load eagerly, and the viewer's moves.
 *
 * Import-free by contract: `node --test` loads it as-is (the CI web job
 * installs nothing). The components are only the wiring around these
 * functions.
 */

/** The fields of `PublicPortfolioItemDto` the gallery reads. */
export interface PublicGalleryItem {
  id: string;
  caption: string | null;
  width: number;
  height: number;
  /** RELATIVE to the web origin (`/media/portfolio/{id}`), used exactly as given. */
  imageUrl: string;
}

/**
 * The outcome of the server read of `GET /service-providers/{id}/portfolio`.
 * `failed` covers a network error, a 5xx and a 404 on a provider whose profile
 * DID load: the page treats every one of them the same way.
 */
export type GalleryRead =
  | { kind: 'loaded'; data: unknown }
  | { kind: 'failed' };

function isGalleryItem(value: unknown): value is PublicGalleryItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.imageUrl === 'string' &&
    typeof item.width === 'number' &&
    typeof item.height === 'number' &&
    (item.caption === null || typeof item.caption === 'string')
  );
}

/**
 * The photos to show, or `null` for NO SECTION AT ALL — no title, no empty
 * message. A visitor does not need to learn that there is nothing to see, and
 * a failed read must never take the profile down with it.
 *
 * Never throws, whatever `data` holds: a body that is not the expected
 * envelope counts as a failure. The order is the API's (the provider's own),
 * never re-sorted here.
 */
export function galleryToShow(read: GalleryRead): PublicGalleryItem[] | null {
  if (read.kind !== 'loaded') return null;
  const data = read.data;
  if (typeof data !== 'object' || data === null) return null;
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items) || !items.every(isGalleryItem)) return null;
  return items.length > 0 ? items : null;
}

/** « Réalisations (5) ». */
export function galleryTitle(count: number): string {
  return `Réalisations (${count})`;
}

/**
 * The caption when there is one, else « Réalisation de {provider} ». A
 * whitespace-only caption counts as none: an `alt` of three spaces says
 * nothing to a screen reader.
 */
export function galleryAlt(caption: string | null, providerName: string): string {
  const trimmed = caption?.trim() ?? '';
  return trimmed !== '' ? trimmed : `Réalisation de ${providerName}`;
}

/**
 * How many thumbnails load eagerly. The first row on a phone is two photos:
 * they are in view at once, and `loading="lazy"` on them would only delay what
 * the visitor is already looking at.
 */
export const EAGER_THUMBNAILS = 2;

export function thumbnailLoading(index: number): 'eager' | 'lazy' {
  return index < EAGER_THUMBNAILS ? 'eager' : 'lazy';
}

/** The previous photo, or `null` on the first. No wrap-around in V1. */
export function previousIndex(index: number): number | null {
  return index > 0 ? index - 1 : null;
}

/** The next photo, or `null` on the last. No wrap-around in V1. */
export function nextIndex(index: number, total: number): number | null {
  return index < total - 1 ? index + 1 : null;
}

/** « 3 / 5 » — the position is 1-based for a human, the index 0-based. */
export function viewerCounter(index: number, total: number): string {
  return `${index + 1} / ${total}`;
}

/**
 * Where an arrow key takes the viewer: ← the previous photo, → the next.
 * `null` = nothing to do (another key, or a bound already reached), so the
 * caller leaves the event alone.
 */
export function viewerKeyTarget(key: string, index: number, total: number): number | null {
  if (key === 'ArrowLeft') return previousIndex(index);
  if (key === 'ArrowRight') return nextIndex(index, total);
  return null;
}
