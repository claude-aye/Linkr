import Link from 'next/link';

/**
 * The Espace pro's tab bar — a SERVER component. It renders links, nothing
 * else: no `'use client'`, no state, no network call. The active tab lives in
 * the URL and is resolved by the page; this file only paints it.
 *
 * ⚠️ NOT `role="tablist"`, DELIBERATELY. These are navigation links that change
 * the URL, not ARIA tabs driven from the keyboard. A `tablist` would promise
 * arrow-key navigation that plain links do not provide — a worse lie to a
 * screen reader than no role at all. Hence a plain `<nav>` with
 * `aria-current="page"` on the active link.
 */

/**
 * ⚠️ THESE SLUGS ARE QUASI-IMMUTABLE — THEY TRAVEL IN EMAILS.
 *
 * `deposit-failed-provider` builds its button on
 * `WEB_APP_BASE_URL + /dashboard?onglet=jobs`, and an email outlives any
 * refactor: renaming a slug breaks links ALREADY SENT, in the inbox of a
 * provider whose deposit just failed — precisely the person who cannot afford
 * a dead end. Same reasoning as `/account/payment-methods` (§13.1 nº 19a).
 *
 * `appels-offres` is in the same position (PR 3): every `NEW_TENDER_MATCH`
 * notification links to `/dashboard?onglet=appels-offres`, and a notification
 * is a link that outlives the tender it announced.
 *
 * If one ever has to move, the old value must keep resolving here rather than
 * fall through to the default: silently landing someone on another tab is the
 * failure mode this note exists to prevent.
 *
 * The order of this array IS the order of the bar (locked): En attente ·
 * Appels d'offres · Mes jobs · Mes métiers · Notifications · Avis.
 *
 * « Appels d'offres » sits SECOND, right after the inbox and never before it:
 * the inbox holds requests aimed at this provider by name, answered within
 * hours; a tender is an open call shared with every provider in range, with a
 * deadline counted in days. It is NEVER the default tab either — the page's
 * default logic is unchanged.
 */
export const DASHBOARD_TABS = [
  { slug: 'en-attente', label: 'En attente' },
  { slug: 'appels-offres', label: 'Appels d’offres' },
  { slug: 'jobs', label: 'Mes jobs' },
  { slug: 'metiers', label: 'Mes métiers' },
  { slug: 'notifications', label: 'Notifications' },
  { slug: 'avis', label: 'Avis' },
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number]['slug'];

/**
 * A known slug, or `null` for anything else — absent, misspelt, or the array
 * a repeated `?onglet=` produces. The caller turns `null` into the default
 * tab: an unknown value NEVER yields an error or an empty page.
 */
export function parseDashboardTab(raw: string | undefined): DashboardTab | null {
  return DASHBOARD_TABS.some((tab) => tab.slug === raw) ? (raw as DashboardTab) : null;
}

/**
 * What each counter COUNTS, spelled out for a screen reader. A bare « Mes jobs
 * 4 » means nothing to the ear, so every number ships with its noun, agreed in
 * number. `null` means « we could not read it » — no counter at all, and
 * never a zero standing in for an unknown.
 */
const COUNTER_LABELS: Record<DashboardTab, (n: number) => string> = {
  'en-attente': (n) => (n > 1 ? `${n} demandes en attente` : `${n} demande en attente`),
  // Counts tenders WITHOUT a live (SUBMITTED) quote — what is still to handle,
  // not the size of the feed (`tendersToHandleCount`).
  'appels-offres': (n) =>
    n > 1 ? `${n} appels d’offres à traiter` : `${n} appel d’offres à traiter`,
  jobs: (n) => (n > 1 ? `${n} jobs` : `${n} job`),
  metiers: (n) => (n > 1 ? `${n} métiers déclarés` : `${n} métier déclaré`),
  notifications: (n) =>
    n > 1 ? `${n} notifications non lues` : `${n} notification non lue`,
  avis: (n) => (n > 1 ? `${n} avis` : `${n} avis`),
};

export interface DashboardTabsProps {
  active: DashboardTab;
  /**
   * Per-tab counter. `null` = the section's read failed, so the tab still
   * shows (the bar must not shift between loads) but carries NO number.
   * Zero also shows nothing — a counter is a signal, not a field.
   */
  counts: Record<DashboardTab, number | null>;
  /**
   * How many jobs hold an unsettled deposit. Drives the amber marker on « Mes
   * jobs », which is distinct from the counter and says something else
   * entirely: the job is yours, the money is not on its way.
   *
   * ⚠️ IT DOES NOT CHANGE THE DEFAULT TAB. The email tells the provider to
   * WAIT for the client to fix their card, not to retry now; opening the page
   * on the retry button would push them to do the opposite.
   */
  depositUnsettledCount: number;
}

export function DashboardTabs({
  active,
  counts,
  depositUnsettledCount,
}: DashboardTabsProps) {
  return (
    <nav aria-label="Sections du tableau de bord">
      {/*
        Mobile falls back to a VERTICAL LIST, never a horizontally scrolling
        bar: a tab hidden behind a silent sideways scroll is a dead tab (the
        lesson `overflow-x-auto` taught the nav in G-1). `min-h-11` keeps every
        target at 44 px, comfortably over the 24 px WCAG 2.5.8 floor.
      */}
      <ul className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-2">
        {DASHBOARD_TABS.map((tab) => {
          const isActive = tab.slug === active;
          const count = counts[tab.slug];
          const showDeposit = tab.slug === 'jobs' && depositUnsettledCount > 0;

          return (
            <li key={tab.slug}>
              <Link
                // Absolute, not the shorter `?onglet=…`: the App Router's
                // <Link> documents an absolute path (or a {pathname, query}
                // object) and says nothing about resolving a query-only href
                // against the current URL. This bar only ever renders on
                // /dashboard, so spelling it out costs nothing and does not
                // lean on undocumented resolution.
                href={`/dashboard?onglet=${tab.slug}`}
                // Without this, Next scrolls back to the top on every click,
                // which throws the provider above the Connect band each time.
                scroll={false}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-sm font-medium transition ${
                  isActive
                    ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                <span className="flex items-center gap-2">
                  {tab.label}
                  {/* Visual only. Its spoken half is deliberately NOT here: read
                      in place it would wedge a second number between the label
                      and its own count (« Mes jobs 4 dépôts à relancer 4 jobs »).
                      It is voiced at the end of the link instead. */}
                  {showDeposit && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
                      aria-hidden="true"
                    />
                  )}
                </span>
                {count !== null && count > 0 && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      isActive
                        ? 'bg-white/25 text-white dark:bg-zinc-900/15 dark:text-zinc-900'
                        : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    {/* The bare digit is hidden and the sentence carries it, so
                        the number is never announced twice. */}
                    <span aria-hidden="true">{count}</span>
                    <span className="sr-only">{COUNTER_LABELS[tab.slug](count)}</span>
                  </span>
                )}
                {/* Last, so the link reads « Mes jobs, 4 jobs, 4 dépôts à
                    relancer »: what the tab is, how much it holds, then the
                    exception — each number with the noun it counts. */}
                {showDeposit && (
                  <span className="sr-only">
                    {depositUnsettledCount > 1
                      ? `${depositUnsettledCount} dépôts à relancer`
                      : `${depositUnsettledCount} dépôt à relancer`}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
