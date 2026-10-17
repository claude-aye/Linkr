/**
 * Rules of the « Portfolio » tab (P2): what the screen checks before an upload,
 * how it words every error, how a move rebuilds the order, what the counter
 * says, and how the upload relay inspects the body it was handed.
 *
 * Import-free by contract: `node --test` loads it as-is (the CI web job
 * installs nothing). The limits are therefore PARAMETERS — the callers pass
 * the mirrored constants of `portfolio-limits.ts`, so a change there flows into
 * every message without a second copy here.
 *
 * Messages are in French, « vous », no jargon. The pre-upload checks are a
 * COMFORT: the API reads the type from the bytes and stays the authority, so
 * every one of its refusals is worded here too.
 */

export interface PortfolioLimits {
  maxItems: number;
  maxBytes: number;
  captionMax: number;
}

/**
 * Declared types the screen accepts. Also the `accept` attribute of the file
 * input — no `capture`, so a phone still offers the gallery AND the camera.
 */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_TYPES.join(',');

/** Machine code of the API's « portfolio full » 409 (P1, part of the contract). */
export const PORTFOLIO_LIMIT_REACHED = 'PORTFOLIO_LIMIT_REACHED';

/**
 * Next's default `experimental.proxyClientMaxBodySize` (10 MB). `proxy.ts` runs
 * on `/api/*`, so Next buffers every request body there — and past this size
 * it TRUNCATES it silently, without an error. Not configured in this app.
 */
export const NEXT_PROXY_BODY_LIMIT = 10485760;

export const UNAVAILABLE_MESSAGE =
  'Le service est momentanément indisponible. Réessayez plus tard.';
export const SESSION_EXPIRED_MESSAGE =
  'Votre session a expiré. Veuillez vous reconnecter.';

/** « 5 Mo » from 5242880 — a comma for a fraction, as in Québec. */
export function megabytesLabel(bytes: number): string {
  const mb = bytes / 1048576;
  const text = Number.isInteger(mb) ? String(mb) : mb.toFixed(1).replace('.', ',');
  return `${text} Mo`;
}

export function tooLargeMessage(limits: PortfolioLimits): string {
  return `Cette photo dépasse ${megabytesLabel(limits.maxBytes)}.`;
}

export const UNSUPPORTED_TYPE_MESSAGE =
  'Format non accepté. Utilisez une photo JPEG, PNG ou WebP. Sur iPhone, les photos HEIC ne sont pas acceptées : réglez Appareil photo › Formats sur « Le plus compatible ».';

export const TOO_MANY_PIXELS_MESSAGE = 'Cette image est trop grande en pixels.';

export function portfolioFullMessage(limits: PortfolioLimits): string {
  return `Votre portfolio est complet (${limits.maxItems} photos). Supprimez-en une pour en ajouter une autre.`;
}

export function captionTooLongMessage(limits: PortfolioLimits): string {
  return `La légende ne doit pas dépasser ${limits.captionMax} caractères.`;
}

/**
 * Check before any network call. `null` = let it go to the API.
 *
 * An EMPTY declared type passes: some browsers declare none, and the API reads
 * the real type from the bytes anyway. Only a type that is declared AND not
 * one of the three is refused here.
 */
export function preUploadCheck(
  file: { size: number; type: string } | null | undefined,
  limits: PortfolioLimits,
): string | null {
  if (!file) return 'Choisissez une photo.';
  if (file.size > limits.maxBytes) return tooLargeMessage(limits);
  const type = file.type.trim().toLowerCase();
  if (type !== '' && !(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)) {
    return UNSUPPORTED_TYPE_MESSAGE;
  }
  return null;
}

/**
 * Upload errors. `status` 0 = network failure (no response at all).
 *
 * The 409 is the one place the body is read: the API gives that refusal an
 * explicit `code` precisely so the screen can name it (P1). Any other 409 —
 * none exists today on this route — falls back to a neutral sentence rather
 * than claiming the portfolio is full.
 */
export function uploadErrorMessage(
  status: number,
  code: string | null | undefined,
  limits: PortfolioLimits,
): string {
  switch (status) {
    case 400:
      return `La photo n’a pas pu être envoyée. Vérifiez le fichier, et que la légende ne dépasse pas ${limits.captionMax} caractères.`;
    case 401:
      return SESSION_EXPIRED_MESSAGE;
    case 404:
      return 'Votre profil prestataire est introuvable. Veuillez actualiser la page.';
    case 409:
      return code === PORTFOLIO_LIMIT_REACHED
        ? portfolioFullMessage(limits)
        : 'Cette photo n’a pas pu être ajoutée. Veuillez actualiser la page.';
    case 413:
      return tooLargeMessage(limits);
    case 415:
      return UNSUPPORTED_TYPE_MESSAGE;
    case 422:
      return TOO_MANY_PIXELS_MESSAGE;
    default:
      return UNAVAILABLE_MESSAGE;
  }
}

export function captionErrorMessage(status: number, limits: PortfolioLimits): string {
  switch (status) {
    case 400:
      return captionTooLongMessage(limits);
    case 401:
      return SESSION_EXPIRED_MESSAGE;
    case 404:
      return 'Cette photo n’existe plus. La page va être actualisée.';
    default:
      return UNAVAILABLE_MESSAGE;
  }
}

/** The screen always shows the server's order again after a failed move. */
export function reorderErrorMessage(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return 'L’ordre n’a pas pu être enregistré : votre portfolio a changé entre-temps. L’ordre enregistré est réaffiché.';
    case 401:
      return SESSION_EXPIRED_MESSAGE;
    default:
      return 'L’ordre n’a pas pu être enregistré. L’ordre précédent est réaffiché. Réessayez plus tard.';
  }
}

export function deleteErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return SESSION_EXPIRED_MESSAGE;
    default:
      return UNAVAILABLE_MESSAGE;
  }
}

/**
 * The new order after moving the photo at `index` by one place (`-1` = up,
 * `+1` = down). `null` when nothing moves — the first photo cannot go up, the
 * last cannot go down, an index outside the list moves nothing. The result is
 * always EXACTLY the same set of ids: `PUT order` refuses anything else (422).
 */
export function moveItem(ids: readonly string[], index: number, delta: -1 | 1): string[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= ids.length) return null;
  const target = index + delta;
  if (target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** « 0 photo sur 12 », « 1 photo sur 12 », « 3 photos sur 12 ». */
export function photoCountLabel(count: number, limits: PortfolioLimits): string {
  return `${count} ${count > 1 ? 'photos' : 'photo'} sur ${limits.maxItems}`;
}

export function isPortfolioFull(count: number, limits: PortfolioLimits): boolean {
  return count >= limits.maxItems;
}

export function remainingSlots(count: number, limits: PortfolioLimits): number {
  return Math.max(0, limits.maxItems - count);
}

export type UploadInspection =
  | { ok: true }
  | { ok: false; status: 400 | 413; message: string };

/**
 * What the upload relay checks on the body it received, before forwarding the
 * bytes untouched. It does NOT judge the image — the API does.
 *
 * - not `multipart/form-data` → 400;
 * - empty body → 400;
 * - fewer bytes than the announced `Content-Length`, or a body that fills the
 *   proxy buffer to the byte → 413: Next truncated it (see
 *   NEXT_PROXY_BODY_LIMIT), and forwarding half a file would earn a confusing
 *   400 from the API instead of the truth, « too large ».
 */
export function inspectUploadRequest(
  contentType: string | null,
  declaredLength: string | null,
  receivedLength: number,
  limits: PortfolioLimits,
): UploadInspection {
  if (!contentType || !/^multipart\/form-data\s*;/i.test(contentType)) {
    return {
      ok: false,
      status: 400,
      message: 'La photo doit être envoyée par le formulaire d’ajout.',
    };
  }
  if (receivedLength === 0) {
    return { ok: false, status: 400, message: 'Aucune photo n’a été reçue.' };
  }
  const declared = declaredLength === null ? NaN : Number(declaredLength);
  const truncated =
    (Number.isFinite(declared) && receivedLength < declared) ||
    receivedLength >= NEXT_PROXY_BODY_LIMIT;
  if (truncated) {
    return { ok: false, status: 413, message: tooLargeMessage(limits) };
  }
  return { ok: true };
}
