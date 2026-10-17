'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

import {
  galleryAlt,
  galleryTitle,
  nextIndex,
  previousIndex,
  thumbnailLoading,
  viewerCounter,
  viewerKeyTarget,
  type PublicGalleryItem,
} from '@/lib/portfolio/public-gallery';

/**
 * « Réalisations » — the provider's photos on their profile, and a viewer to
 * enlarge them (P3).
 *
 * The grid is rendered on the server like the rest of the page, so it stays
 * visible WITHOUT JavaScript: each thumbnail is then a plain link to the photo
 * itself (`imageUrl`, an INTERNAL relay URL — the anti-bypass rule forbids any
 * outbound link, not this one). Once hydrated, the click opens the viewer
 * instead (`preventDefault`).
 *
 * ⚠️ CAPTIONS ARE INERT TEXT. They are typed by the provider, so they go
 * through React's escaping as `{caption}`: no raw-HTML injection (a test
 * greps this file for it), no link detection, never inside an `<a>`. A phone
 * number or a URL in a caption stays a string nobody can click (décision
 * d'Ayé du 17 octobre).
 *
 * The viewer is a native `<dialog>` opened with `showModal()`, like
 * `ConfirmDialog`: focus trap, background inertness and Escape come from the
 * platform. It is not `ConfirmDialog` itself, which is shaped for a
 * confirmation (title, confirm button, pending state).
 */
export function PortfolioGallery({
  items,
  providerName,
}: {
  /** Never empty: the page renders no section at all for zero photos. */
  items: PublicGalleryItem[];
  providerName: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const thumbnailRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  /** The thumbnail that opened the viewer — focus goes back to it on close. */
  const originRef = useRef<number | null>(null);

  // `null` = the viewer is closed. Single source of truth for the dialog.
  const [index, setIndex] = useState<number | null>(null);

  const total = items.length;
  const isOpen = index !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  function open(at: number, event: MouseEvent<HTMLAnchorElement>) {
    // Without JS, the link opens the photo; with it, the viewer does.
    event.preventDefault();
    originRef.current = at;
    setIndex(at);
  }

  /**
   * Runs on every way out — Escape (the native `cancel` → `close`), « Fermer »,
   * a click on the backdrop. Focus goes back to the thumbnail that opened the
   * viewer, not to the photo the visitor ended on: that is where they were.
   */
  function handleClose() {
    setIndex(null);
    const origin = originRef.current;
    originRef.current = null;
    if (origin !== null) thumbnailRefs.current[origin]?.focus();
  }

  /**
   * Moves to `to`. When the move lands on a bound, the button just pressed
   * becomes disabled — and a disabled button drops focus to the document,
   * outside the dialog. Hand it to the other arrow (or « Fermer » for a single
   * photo) before that happens.
   */
  function go(to: number) {
    setIndex(to);
    const active = document.activeElement;
    if (active === nextRef.current && nextIndex(to, total) === null) {
      (previousIndex(to) === null ? closeRef : previousRef).current?.focus();
    } else if (active === previousRef.current && previousIndex(to) === null) {
      (nextIndex(to, total) === null ? closeRef : nextRef).current?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (index === null) return;
    const to = viewerKeyTarget(event.key, index, total);
    if (to === null) return;
    event.preventDefault();
    go(to);
  }

  /** A click on the dark area around the photo closes; a click on the photo,
      its caption or a button does not. */
  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    const target = event.target as HTMLElement;
    if (target === event.currentTarget || target.dataset.backdrop !== undefined) {
      dialogRef.current?.close();
    }
  }

  const current = index === null ? null : items[index];
  const previous = index === null ? null : previousIndex(index);
  const next = index === null ? null : nextIndex(index, total);

  return (
    <section aria-labelledby="realisations-title" className="mb-8">
      <h2
        id="realisations-title"
        className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        {galleryTitle(total)}
      </h2>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item, i) => (
          <li key={item.id} className="min-w-0">
            <a
              href={item.imageUrl}
              ref={(node) => {
                thumbnailRefs.current[i] = node;
              }}
              onClick={(event) => open(i, event)}
              aria-haspopup="dialog"
              className="block overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-800 dark:bg-zinc-900"
            >
              {/* A plain <img>, not next/image: the relay already serves a
                  re-encoded WebP ≤ 1600 px, and the RELATIVE `imageUrl` is used
                  exactly as the API returns it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.imageUrl}
                width={item.width}
                height={item.height}
                alt={galleryAlt(item.caption, providerName)}
                loading={thumbnailLoading(i)}
                className="aspect-square h-auto w-full object-cover"
              />
            </a>
            {item.caption && (
              <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {item.caption}
              </p>
            )}
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        aria-label={`Réalisations de ${providerName}`}
        onClose={handleClose}
        onKeyDown={handleKeyDown}
        onClick={handleBackdropClick}
        className="m-0 h-full max-h-none w-full max-w-none bg-black p-0 text-white backdrop:bg-black"
      >
        {current && index !== null && (
          <div data-backdrop className="flex h-full flex-col gap-3 p-4">
            <div data-backdrop className="flex items-center justify-between gap-3">
              {/* Announced on every move, so a screen reader hears where it is. */}
              <p aria-live="polite" className="text-sm font-medium">
                {viewerCounter(index, total)}
              </p>
              <button
                ref={closeRef}
                type="button"
                onClick={() => dialogRef.current?.close()}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-white/10 px-4 text-sm font-medium hover:bg-white/20"
              >
                Fermer
              </button>
            </div>

            <div data-backdrop className="flex min-h-0 flex-1 items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.imageUrl}
                width={current.width}
                height={current.height}
                alt={galleryAlt(current.caption, providerName)}
                className="h-auto max-h-full w-auto max-w-full object-contain"
              />
            </div>

            {current.caption && (
              <p className="text-center text-sm break-words text-zinc-200">{current.caption}</p>
            )}

            <div data-backdrop className="flex items-center justify-between gap-3">
              <button
                ref={previousRef}
                type="button"
                disabled={previous === null}
                onClick={() => previous !== null && go(previous)}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-4 text-sm font-medium hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span aria-hidden="true">←</span> Précédente
              </button>
              <button
                ref={nextRef}
                type="button"
                disabled={next === null}
                onClick={() => next !== null && go(next)}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-4 text-sm font-medium hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Suivante <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}
