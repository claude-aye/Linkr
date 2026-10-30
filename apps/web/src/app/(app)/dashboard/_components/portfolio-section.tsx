'use client';

import { type FormEvent, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { components } from '@linkr/api-client';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PORTFOLIO_LIMITS } from '@/lib/portfolio/portfolio-limits';
import {
  ACCEPT_ATTRIBUTE,
  UNAVAILABLE_MESSAGE,
  captionErrorMessage,
  deleteErrorMessage,
  isPortfolioFull,
  megabytesLabel,
  moveItem,
  photoCountLabel,
  portfolioFullMessage,
  preUploadCheck,
  remainingSlots,
  reorderErrorMessage,
  uploadErrorMessage,
} from '@/lib/portfolio/portfolio-rules';

/**
 * The « Portfolio » tab of the Espace pro (P2): add, caption, reorder and
 * delete the provider's photos — on a computer AND on a phone.
 *
 * - The browser only ever talks to the web origin: uploads and mutations go to
 *   the `/api/service-providers/me/portfolio…` relays, and every thumbnail is
 *   the RELATIVE `imageUrl` the API returns (/media/portfolio/{id}), never
 *   rebuilt here.
 * - The list comes from the Server Component (`page.tsx`). After each success,
 *   `router.refresh()` reads it again — inside a transition, so the old screen
 *   stays until the new data is there (pattern of `service-row.tsx`).
 * - Reordering uses « Monter » / « Descendre » buttons, no drag and drop (no
 *   dependency, works with a keyboard and a thumb). The move shows at once;
 *   on failure the SERVER's order comes back.
 *
 * Every check and every message lives in `lib/portfolio/portfolio-rules.ts`.
 */

export type PortfolioItem = components['schemas']['PortfolioItemDto'];

export interface PortfolioSectionProps {
  /** Live photos, in display order, as the API returned them. */
  items: PortfolioItem[];
}

const LIMITS = PORTFOLIO_LIMITS;
const BASE_URL = '/api/service-providers/me/portfolio';

const inputClass =
  'w-full rounded-2xl border border-edge bg-surface min-h-11 px-3 py-2 text-base text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent';
const labelClass = 'block text-sm font-medium text-text-muted';
const hintClass = 'mt-1 text-xs text-text-muted';
const errorClass =
  'rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800';
const primaryButtonClass =
  'min-h-11 rounded-2xl bg-accent px-4 text-sm font-medium text-on-accent shadow-sm transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60';
/** Tile buttons: two per row in a 2-column phone grid, hence the tight padding. */
const tileButtonClass =
  'min-h-11 whitespace-nowrap rounded-2xl border border-edge px-1 text-xs font-medium text-text-muted transition hover:bg-text/5 disabled:cursor-not-allowed disabled:opacity-50';
const tileDangerClass =
  'min-h-11 whitespace-nowrap rounded-2xl border border-red-300 px-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50';

/** The `code` of an error body, read ONLY for the upload's 409 (P1 contract). */
async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { code?: unknown } | null;
    return typeof body?.code === 'string' ? body.code : null;
  } catch {
    return null;
  }
}

export function PortfolioSection({ items }: PortfolioSectionProps) {
  const router = useRouter();
  const idBase = useId();
  const fileId = `${idBase}-file`;
  const captionId = `${idBase}-caption`;
  const fileHintId = `${idBase}-file-hint`;
  const captionCountId = `${idBase}-caption-count`;

  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // A move shows at once; `null` = show the server's order (the props).
  const [optimisticIds, setOptimisticIds] = useState<string[] | null>(null);
  const [reordering, setReordering] = useState(false);
  // Deleted here, not yet gone from the props (the refresh lands a beat later).
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const [refreshing, startRefresh] = useTransition();

  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered =
    optimisticIds && optimisticIds.every((id) => byId.has(id))
      ? optimisticIds.map((id) => byId.get(id) as PortfolioItem)
      : items;
  const shown = ordered.filter((item) => !removedIds.has(item.id));

  const count = shown.length;
  const full = isPortfolioFull(count, LIMITS);
  const busy = uploading || reordering || refreshing;

  function refresh(after?: () => void) {
    startRefresh(() => {
      after?.();
      router.refresh();
    });
  }

  function onFileChange() {
    const file = fileRef.current?.files?.[0];
    // Immediate feedback on a file the screen already knows the API refuses.
    setUploadError(file ? preUploadCheck(file, LIMITS) : null);
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading || full) return;
    setError(null);
    setAnnouncement('');

    const file = fileRef.current?.files?.[0];
    const problem = preUploadCheck(file, LIMITS);
    if (problem || !file) {
      setUploadError(problem);
      fileRef.current?.focus();
      return;
    }
    setUploadError(null);

    const form = new FormData();
    form.append('file', file);
    const trimmed = caption.trim();
    if (trimmed !== '') form.append('caption', trimmed);

    setUploading(true);
    let response: Response;
    try {
      response = await fetch(BASE_URL, { method: 'POST', body: form });
    } catch {
      setUploading(false);
      setUploadError(UNAVAILABLE_MESSAGE);
      return;
    }

    if (response.status === 201) {
      formRef.current?.reset();
      setCaption('');
      setAnnouncement('Photo ajoutée.');
      // `uploading` drops with the refresh, so the button cannot be pressed
      // again before the new photo is on screen.
      refresh(() => setUploading(false));
      return;
    }

    const code = response.status === 409 ? await readErrorCode(response) : null;
    setUploading(false);
    setUploadError(uploadErrorMessage(response.status, code, LIMITS));
    if (response.status === 409) refresh();
  }

  async function move(index: number, delta: -1 | 1) {
    if (busy) return;
    const ids = moveItem(
      shown.map((item) => item.id),
      index,
      delta,
    );
    if (!ids) return;

    setError(null);
    setAnnouncement('');
    setOptimisticIds(ids);
    setReordering(true);

    let ok = false;
    let status = 0;
    try {
      const response = await fetch(`${BASE_URL}/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      ok = response.ok;
      status = response.status;
    } catch {
      ok = false;
    }

    if (ok) {
      const newIndex = index + delta;
      setAnnouncement(`Photo déplacée en position ${newIndex + 1} sur ${ids.length}.`);
      refresh(() => {
        setReordering(false);
        setOptimisticIds(null);
      });
      return;
    }

    // The server's order comes back on screen, then is read again.
    setOptimisticIds(null);
    setError(reorderErrorMessage(status));
    refresh(() => setReordering(false));
  }

  return (
    <section aria-labelledby="portfolio-title" className="space-y-6">
      <div>
        <h2
          id="portfolio-title"
          className="text-lg font-semibold text-text"
        >
          Portfolio
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          <span className="font-medium text-text">
            {photoCountLabel(count, LIMITS)}
          </span>
          {!full && (
            <>
              {' '}
              · {remainingSlots(count, LIMITS)}{' '}
              {remainingSlots(count, LIMITS) > 1 ? 'places restantes' : 'place restante'}
            </>
          )}
        </p>
      </div>

      {/* Add a photo */}
      <form
        ref={formRef}
        method="post"
        onSubmit={handleUpload}
        noValidate
        className="space-y-4 rounded-2xl border border-edge bg-surface p-4"
      >
        <div>
          <label htmlFor={fileId} className={labelClass}>
            Photo
          </label>
          {/* No `capture`: on a phone the picker keeps BOTH the gallery and
              the camera. */}
          <input
            ref={fileRef}
            id={fileId}
            name="file"
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            disabled={full || uploading}
            onChange={onFileChange}
            aria-describedby={fileHintId}
            aria-invalid={uploadError ? true : undefined}
            className="mt-1 block w-full min-h-11 text-sm text-text-muted file:mr-3 file:min-h-11 file:rounded-2xl file:border-0 file:bg-text/5 file:px-4 file:text-sm file:font-medium file:text-text hover:file:bg-text/10 disabled:opacity-60"
          />
          <p id={fileHintId} className={hintClass}>
            JPEG, PNG ou WebP, {megabytesLabel(LIMITS.maxBytes)} au plus.
          </p>
        </div>

        <div>
          <label htmlFor={captionId} className={labelClass}>
            Légende <span className="font-normal text-text-muted">(facultative)</span>
          </label>
          <textarea
            id={captionId}
            name="caption"
            rows={2}
            maxLength={LIMITS.captionMax}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            disabled={full || uploading}
            aria-describedby={captionCountId}
            className={`mt-1 ${inputClass}`}
          />
          <p id={captionCountId} className={`${hintClass} text-right`}>
            {caption.length} / {LIMITS.captionMax} caractères
          </p>
        </div>

        {uploadError && (
          <p role="alert" className={errorClass}>
            {uploadError}
          </p>
        )}
        {full && (
          <p className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {portfolioFullMessage(LIMITS)}
          </p>
        )}

        <button
          type="submit"
          disabled={full || uploading}
          aria-busy={uploading}
          className={`${primaryButtonClass} w-full sm:w-auto`}
        >
          {uploading ? 'Envoi en cours…' : 'Ajouter la photo'}
        </button>

        <p className="text-xs text-text-muted">
          Les données de localisation de vos photos sont retirées automatiquement.
        </p>
      </form>

      {/* Present even when empty: a region inserted together with its content
          is often not announced. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-edge p-6 text-center text-sm text-text-muted">
          Votre portfolio est vide. Ajoutez des photos de vos réalisations : elles
          s’afficheront sur votre profil.
        </p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((item, index) => (
            <PortfolioTile
              key={item.id}
              item={item}
              index={index}
              total={shown.length}
              disabled={busy}
              onMove={move}
              onRemoved={(id, message) => {
                setRemovedIds((prev) => new Set(prev).add(id));
                setAnnouncement(message);
                refresh();
              }}
              onCaptionSaved={(message) => {
                setAnnouncement(message);
                refresh();
              }}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

interface PortfolioTileProps {
  item: PortfolioItem;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (index: number, delta: -1 | 1) => void;
  onRemoved: (id: string, message: string) => void;
  onCaptionSaved: (message: string) => void;
}

function PortfolioTile({
  item,
  index,
  total,
  disabled,
  onMove,
  onRemoved,
  onCaptionSaved,
}: PortfolioTileProps) {
  const idBase = useId();
  const captionFieldId = `${idBase}-caption`;
  const captionCountId = `${idBase}-count`;
  const position = index + 1;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const url = `${BASE_URL}/${item.id}`;
  const alt = item.caption ?? 'Photo du portfolio';

  function startEditing() {
    setDraft(item.caption ?? '');
    setCaptionError(null);
    setEditing(true);
  }

  async function saveCaption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const trimmed = draft.trim();
    setSaving(true);
    setCaptionError(null);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // An empty caption clears it — sent as null.
        body: JSON.stringify({ caption: trimmed === '' ? null : trimmed }),
      });
    } catch {
      setSaving(false);
      setCaptionError(UNAVAILABLE_MESSAGE);
      return;
    }

    setSaving(false);
    if (response.ok) {
      setEditing(false);
      onCaptionSaved(trimmed === '' ? 'Légende retirée.' : 'Légende enregistrée.');
      return;
    }
    setCaptionError(captionErrorMessage(response.status, LIMITS));
    if (response.status === 404) onCaptionSaved('');
  }

  async function confirmDelete() {
    let response: Response;
    try {
      response = await fetch(url, { method: 'DELETE' });
    } catch {
      throw new Error(UNAVAILABLE_MESSAGE);
    }
    if (response.status === 204) {
      onRemoved(item.id, 'Photo supprimée.');
      return;
    }
    if (response.status === 404) {
      // Already gone — the goal is reached, the grid only needs to catch up.
      onRemoved(item.id, 'Cette photo avait déjà été supprimée.');
      return;
    }
    throw new Error(deleteErrorMessage(response.status));
  }

  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-edge bg-surface p-2">
      {/* A plain <img>, not next/image: the relay already serves a re-encoded
          WebP ≤ 1600 px, and the RELATIVE `imageUrl` is used exactly as the API
          returned it. `width`/`height` reserve the space before the bytes
          arrive. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.imageUrl}
        width={item.width}
        height={item.height}
        loading="lazy"
        alt={alt}
        className="aspect-square w-full rounded-2xl bg-text/5 object-cover"
      />

      {editing ? (
        <form method="post" onSubmit={saveCaption} noValidate className="space-y-2">
          <label htmlFor={captionFieldId} className="sr-only">
            Légende de la photo {position}
          </label>
          <textarea
            id={captionFieldId}
            rows={3}
            maxLength={LIMITS.captionMax}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby={captionCountId}
            className={`${inputClass} text-xs`}
            autoFocus
          />
          <p id={captionCountId} className={`${hintClass} text-right`}>
            {draft.length} / {LIMITS.captionMax}
          </p>
          {captionError && (
            <p role="alert" className={`${errorClass} text-xs`}>
              {captionError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-1">
            <button type="submit" disabled={saving} className={tileButtonClass}>
              {saving ? 'Envoi…' : 'Enregistrer'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
              className={tileButtonClass}
            >
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="min-h-4 break-words text-xs text-text-muted">
            {item.caption ?? (
              <span className="text-text-muted">Sans légende</span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              disabled={disabled || index === 0}
              onClick={() => onMove(index, -1)}
              aria-label={`Monter la photo ${position}`}
              className={tileButtonClass}
            >
              Monter
            </button>
            <button
              type="button"
              disabled={disabled || index === total - 1}
              onClick={() => onMove(index, 1)}
              aria-label={`Descendre la photo ${position}`}
              className={tileButtonClass}
            >
              Descendre
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={startEditing}
              aria-label={`Modifier la légende de la photo ${position}`}
              className={tileButtonClass}
            >
              Légende
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setDeleteOpen(true)}
              aria-label={`Supprimer la photo ${position}`}
              className={tileDangerClass}
            >
              Supprimer
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Supprimer cette photo ?"
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      >
        Elle sera effacée définitivement.
      </ConfirmDialog>
    </li>
  );
}
