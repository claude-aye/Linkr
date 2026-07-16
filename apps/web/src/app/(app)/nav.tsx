import Link from 'next/link';

import { LogoutButton } from './logout-button';

/**
 * Shared `(app)` shell navigation — Server Component, role-conditional
 * (Phase 3.13-PR2).
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
 */
export function Nav({ isProvider }: { isProvider: boolean }) {
  const linkClass =
    'font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50';

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <nav className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <Link
          href="/"
          className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          Linkr
        </Link>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <Link href="/providers" className={linkClass}>
            Trouver un pro
          </Link>
          <Link href="/requests" className={linkClass}>
            Mes demandes
          </Link>
          {isProvider && (
            <Link href="/dashboard" className={linkClass}>
              Mon tableau de bord
            </Link>
          )}
        </div>

        <div className="ml-auto">
          <LogoutButton />
        </div>
      </nav>
    </header>
  );
}
