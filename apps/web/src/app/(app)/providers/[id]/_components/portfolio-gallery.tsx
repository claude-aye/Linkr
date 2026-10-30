'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';

import {
  galleryAlt,
  galleryTitle,
  MARQUEE_GAP_PX,
  marqueeDurationSeconds,
  nextIndex,
  previousIndex,
  shouldLoop,
  thumbnailLoading,
  viewerCounter,
  viewerKeyTarget,
  type PublicGalleryItem,
} from '@/lib/portfolio/public-gallery';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * One copy of the photos. `copy` is the duplicate that closes the loop:
 * `aria-hidden`, links out of the tab order, no ref (focus returns to the
 * real thumbnail), always lazy. Both copies open the viewer on the REAL
 * index, so a click in the second one shows the right photo.
 * The gallery has ONE anchor in its source, here — a test counts on it.
 * A component of its own (not a render helper) so the refs it receives are
 * only read in callbacks, never during render.
 */
function PhotoGroup({
  items,
  providerName,
  copy,
  groupRef,
  thumbnailRefs,
  onOpen,
}: {
  items: PublicGalleryItem[];
  providerName: string;
  copy: boolean;
  groupRef: RefObject<HTMLUListElement | null>;
  thumbnailRefs: RefObject<(HTMLAnchorElement | null)[]>;
  onOpen: (at: number, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <ul
      ref={copy ? undefined : groupRef}
      aria-hidden={copy ? true : undefined}
      className="flex shrink-0 gap-3 pr-3"
    >
      {items.map((item, i) => (
        <li key={item.id} className="w-36 shrink-0 sm:w-44">
          <a
            href={item.imageUrl}
            tabIndex={copy ? -1 : undefined}
            ref={
              copy
                ? undefined
                : (node) => {
                    thumbnailRefs.current[i] = node;
                  }
            }
            onClick={(event) => onOpen(i, event)}
            aria-haspopup="dialog"
            className="block overflow-hidden rounded-2xl border border-edge bg-text/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
              loading={copy ? 'lazy' : thumbnailLoading(i)}
              className="size-36 object-cover sm:size-44"
            />
          </a>
          {item.caption && (
            <p className="mt-1 truncate text-xs text-text-muted">{item.caption}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * « Réalisations » — the provider's photos on their profile, and a viewer to
 * enlarge them (P3).
 *
 * The strip is rendered on the server like the rest of the page, so it stays
 * visible WITHOUT JavaScript: one row of photos, scrolled by hand, each
 * thumbnail a plain link to the photo itself (`imageUrl`, an INTERNAL relay
 * URL — the anti-bypass rule forbids any outbound link, not this one). Once
 * hydrated, the click opens the viewer instead (`preventDefault`).
 *
 * F2 — THE STRIP SCROLLS BY ITSELF, right to left, in a seamless loop. The
 * motion is pure CSS (`@keyframes` + `translateX`, in `globals.css`); the list
 * is rendered a second time, `aria-hidden`, and the track slides by exactly
 * one copy (`-50%`). JavaScript is here for ONE thing CSS cannot do: know
 * whether the photos fill the width. A strip that already fits (one or two
 * photos, a wide screen) must sit still and must NOT be duplicated, and no
 * media query can say how wide the photos are. So a `ResizeObserver` measures
 * the first copy against the viewport, and the second copy exists only while
 * the strip loops. Never under `prefers-reduced-motion: reduce`: the strip is
 * then a single copy, scrolled by hand. Hover pauses it (CSS, `globals.css`),
 * as does the open viewer; keyboard focus stops it altogether (see
 * `keyboardFocus`). No blur on the strip.
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLUListElement>(null);

  // `null` = the viewer is closed. Single source of truth for the dialog.
  const [index, setIndex] = useState<number | null>(null);

  // Server snapshot `true`: the HTML the server sends is the still strip.
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotion,
    () => true,
  );
  const [widths, setWidths] = useState({ content: 0, container: 0 });
  // Keyboard focus inside the strip FREEZES it: a still, hand-scrollable row,
  // so the browser can reveal the focused photo where it really is. Left to
  // loop, the focus would scroll the clipped viewport and, once it left, the
  // loop would resume from a shifted position, with a blank gap on the right.
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const looping =
    !keyboardFocus &&
    shouldLoop({
      contentWidth: widths.content,
      containerWidth: widths.container,
      reducedMotion,
    });

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

  // A loop always starts from the strip's origin, whatever the focus did.
  useEffect(() => {
    if (looping && viewportRef.current) viewportRef.current.scrollLeft = 0;
  }, [looping]);

  // Measures the photos against the room they have. `setWidths` runs in the
  // observer callback (it fires once on `observe`), never in the effect body.
  // Once the strip loops, the first copy keeps its width, so this cannot flip.
  useEffect(() => {
    const viewport = viewportRef.current;
    const group = groupRef.current;
    if (!viewport || !group) return;
    const measure = () => {
      const style = getComputedStyle(viewport);
      const container =
        viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setWidths({ content: group.offsetWidth - MARQUEE_GAP_PX, container });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(group);
    return () => observer.disconnect();
  }, []);

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
    // `preventScroll`: in a looping strip the viewport is `overflow: hidden`,
    // and a focus that scrolls it would make the track jump.
    if (origin !== null) thumbnailRefs.current[origin]?.focus({ preventScroll: true });
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
        className="mb-3 text-lg font-semibold text-text"
      >
        {galleryTitle(total)}
      </h2>

      <div
        ref={viewportRef}
        data-looping={looping}
        data-paused={isOpen}
        onFocus={(event) => {
          if (event.target.matches(':focus-visible')) setKeyboardFocus(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
        }}
        style={{ '--marquee-duration': `${marqueeDurationSeconds(total)}s` } as CSSProperties}
        className={`portfolio-marquee px-1 py-1 ${looping ? 'overflow-hidden' : 'overflow-x-auto pb-3'}`}
      >
        <div className="portfolio-marquee__track flex w-max">
          <PhotoGroup
            items={items}
            providerName={providerName}
            copy={false}
            groupRef={groupRef}
            thumbnailRefs={thumbnailRefs}
            onOpen={open}
          />
          {/* The copy that closes the loop: hidden from assistive tech, out of
              the tab order, and present ONLY while the strip loops. */}
          {looping && (
            <PhotoGroup
              items={items}
              providerName={providerName}
              copy
              groupRef={groupRef}
              thumbnailRefs={thumbnailRefs}
              onOpen={open}
            />
          )}
        </div>
      </div>

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
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl bg-white/10 px-4 text-sm font-medium hover:bg-white/20"
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
              <p className="text-center text-sm break-words text-text-muted">{current.caption}</p>
            )}

            <div data-backdrop className="flex items-center justify-between gap-3">
              <button
                ref={previousRef}
                type="button"
                disabled={previous === null}
                onClick={() => previous !== null && go(previous)}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-white/10 px-4 text-sm font-medium hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span aria-hidden="true">←</span> Précédente
              </button>
              <button
                ref={nextRef}
                type="button"
                disabled={next === null}
                onClick={() => next !== null && go(next)}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-white/10 px-4 text-sm font-medium hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
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
