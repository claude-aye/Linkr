import Link from 'next/link';

import { LogoutButton } from './logout-button';

/**
 * Shared `(app)` shell navigation — Server Component, role-conditional
 * (Phase 3.13-PR2), mobile layout reworked in chantier G-1.
 *
 * Scope A (locked): CLIENT links are always shown; the PROVIDER link appears only
 * when the session resolves to a provider profile. There is NO « Admin » link by
 * design — the admin role is never surfaced to the front (see
 * `lib/nav/capabilities.ts`); `/admin/verifications` stays URL-reachable +
 * API-guarded.
 *
 * `isProvider` is passed in by `(app)/layout.tsx`, which reads
 * `getShellCapabilities()` ONCE per request — this component stays presentational
 * (no data fetch of its own). `LogoutButton` is a client component rendered here
 * by a Server Component (same pattern as the dashboard `_actions`).
 *
 * ⚠️ MOBILE LAYOUT — TWO DELIBERATE ROWS, NOT free `flex-wrap`. Measured before
 * the rework: at <=375px the header was **143px tall over 4 rows** (brand / two
 * client links / provider link / logout alone on its own line), because
 * `flex-wrap` + `ml-auto` on the logout let every group wrap independently and
 * pushed the logout onto a line of its own. That is ~20% of a phone viewport
 * spent before any content. `order-*` + `w-full` now pin the wrap point: row 1 is
 * brand + logout, row 2 is the link strip; from `sm:` the orders flip back and
 * all three sit on ONE row exactly as before. There is NO hamburger and NO
 * client state — the navigation model is unchanged, only where it wraps.
 *
 * ⚠️ TAP TARGETS >=44px — the padding is load-bearing, not cosmetic. The links
 * used to be 20px tall, under the 24px floor of WCAG 2.5.8 (AA) and well under
 * the 44px Apple HIG / 48dp Material target. `py-3` on a 20px line-height gets to
 * exactly 44px WITHOUT growing the visible text. The `-mx-2` on the strip cancels
 * the `px-2` of its first link so the label still starts at 24px from the viewport
 * edge — i.e. flush with the `p-6` of every page `<main>` below. Change one, you
 * must change the other, or the header stops lining up with the content.
 *
 * ⚠️ `shrink-0` + `flex-wrap` ON THE STRIP — BOTH, AND HERE IS WHY IT BIT.
 * A flex item shrinks before it wraps. Without `shrink-0` the three provider
 * links get squeezed past their natural width and the LABELS wrap mid-phrase
 * (« Trouver un / pro »), which measures as no overflow while quietly making
 * every link 64px tall instead of 44px. `shrink-0` keeps each label on one line
 * and `flex-wrap` then moves whole links to a second strip row when they no
 * longer fit. `overflow-x-auto` was tried here and REMOVED: it hides a link
 * behind a silent horizontal scroll, and because `overflow-x: auto` forces the
 * used value of `overflow-y` to `auto`, Chromium reserved a scrollbar gutter
 * that added 20px of header height for a scroll that should never happen.
 *
 * ⚠️ « Espace pro » IS A MEASUREMENT, NOT A PREFERENCE — do not lengthen it back.
 * G-1 shipped this strip with « Mon tableau de bord » and recorded that the
 * provider set did not fit on one row at 375px; that was the ONE label forcing a
 * second strip row, and the regression was left in the queue as a copy decision.
 * Re-measured here after the rename (strip content box vs. sum of link widths +
 * column gaps, Chromium, provider session):
 *
 *   needed 314px (was ~376px) — 107 + 112 + 87 + 2x4px gap
 *   @320 avail 272px → 2 rows, header 137px
 *   @360 avail 312px → 2 rows, header 137px   (2px short — the wrap point)
 *   @375 avail 327px → 1 row,  header  93px
 *   @414 avail 366px → 1 row,  header  93px
 *
 * So the provider header drops 137px → 93px at >=375px, matching the client
 * header exactly, and the wrap point moves from ~480px down to ~362px. A longer
 * label pushes it back up and costs 44px of every phone viewport again.
 *
 * ⚠️ 5.1 SPENDS THAT WIN BACK FOR THE PROVIDER, AND THAT IS THE KNOWN PRICE OF
 * « Mes cartes » — not a regression to hunt down. The deposit-failure email must
 * land on a screen the client can reach again afterwards, so the link is
 * unconditional (any account can hold a card, a provider included). Re-measured
 * here the same way (Chromium, fr-CA, mobile strip gap 4px; widths 107 / 112 /
 * 84 / 87):
 *
 *   CLIENT   needed 311px (was ~223px) — 107 + 112 + 84 + 2x4px gap
 *     @320 avail 272px → 2 rows, header 137px
 *     @360 avail 312px → 1 row,  header  93px   (1px of margin — the wrap point)
 *     @375 avail 327px → 1 row,  header  93px
 *
 *   PROVIDER needed 402px (was 314px) — the same three + 87 + 3x4px gap
 *     @375 avail 327px → 2 rows, header 137px   ← G-1's 93px is gone below 450px
 *     @414 avail 366px → 2 rows, header 137px
 *     @450 avail 402px → 1 row,  header  93px   (the new wrap point)
 *
 * « Mes cartes » is already the shortest honest label: the screen only saves
 * CARDS (the SetupIntent is opened with `payment_method_types: ['card']`), and
 * « Moyens de paiement » measures ~165px, which would push the CLIENT wrap point
 * past 440px too. The way out of this is a menu, not a shorter word — do not
 * shave the label and call it fixed.
 */
export function Nav({ isProvider }: { isProvider: boolean }) {
  // Block-level padding is what makes the target tall enough; the negative margin
  // on the parent strip keeps the text optically aligned with the page content.
  const linkClass =
    'flex shrink-0 items-center rounded-lg px-2 py-3 font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50';

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <nav className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 px-6 py-1 sm:py-3">
        {/* Row 1 (mobile) — brand, then the logout pushed right by `ml-auto`.
            From `sm:` the logout is re-ordered last and `ml-auto` keeps doing
            exactly the same job at the end of the single row. */}
        <Link
          href="/"
          className="order-1 flex items-center py-2 text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          Linkr
        </Link>

        <div className="order-2 ml-auto sm:order-3">
          <LogoutButton />
        </div>

        {/* Row 2 (mobile) — `w-full` forces the strip onto its own line instead of
            letting individual links wrap one by one. From `sm:` it is inline
            again. See the header note on why there is no `overflow-x-auto`. */}
        <div className="order-3 -mx-2 flex w-full flex-wrap items-center gap-x-1 text-sm sm:order-2 sm:mx-0 sm:w-auto sm:gap-x-3">
          <Link href="/recherche" className={linkClass}>
            Trouver un pro
          </Link>
          <Link href="/requests" className={linkClass}>
            Mes demandes
          </Link>
          {/*
            5.1 — client-side, always shown: anyone can hold a card, a provider
            included (they are a client of other providers). The label is the
            SHORTEST honest one for the same reason « Espace pro » is: see the
            measurement note in the header, which this link changes.
          */}
          <Link href="/account/payment-methods" className={linkClass}>
            Mes cartes
          </Link>
          {isProvider && (
            <Link href="/dashboard" className={linkClass}>
              Espace pro
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
