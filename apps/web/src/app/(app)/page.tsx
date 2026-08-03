import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getShellCapabilities } from '@/lib/nav/capabilities';

// Reads the session cookie — always rendered per request.
export const dynamic = 'force-dynamic';

/**
 * Client hub — the post-login landing (Phase 3.13-PR2).
 *
 * Deliberately SOBER: a personalised greeting + the two client entry points
 * (« Trouver un pro », « Mes demandes »), plus ONE role-conditional element —
 * a provider already has a discreet dashboard shortcut, a non-provider gets the
 * « Devenir prestataire » card instead. NO provider listing, NO search, NO geo
 * call: the hub only routes. We do not speculate here.
 *
 * Both branches read `isProvider` from the shell helper this page already
 * awaits — the hub adds NO request of its own.
 */
export default async function HubPage() {
  const { user, isProvider } = await getShellCapabilities();

  // Session gate (defence-in-depth — proxy.ts redirects first). `redirect`
  // throws, so it is called outside any try/catch.
  if (!user) {
    redirect('/login');
  }

  const firstName =
    user.firstName?.trim() || user.displayName?.trim() || user.email;

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Bonjour, {firstName}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Que souhaitez-vous faire aujourd’hui&nbsp;?
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <HubCard
            href="/recherche"
            title="Trouver un pro"
            description="Recherchez un prestataire près de chez vous et réservez un service."
          />
          <HubCard
            href="/requests"
            title="Mes demandes"
            description="Suivez vos réservations et vos projets en cours."
          />
          {/* Third card for the OTHER side of the marketplace, shown only to a
              session that is not a provider yet — the mirror image of the
              dashboard shortcut below. It reuses `isProvider`, ALREADY resolved
              above: no extra request (`GET /service-providers/me` has two call
              sites — the shell helper this page shares with the layout, and the
              dashboard — and this adds no third one). */}
          {!isProvider && (
            <HubCard
              href="/providers/new"
              title="Devenir prestataire"
              description="Créez votre profil pour offrir vos services et recevoir des demandes."
            />
          )}
        </div>

        {isProvider && (
          <div className="mt-6">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              Accéder à mon tableau de bord prestataire →
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

function HubCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-zinc-300 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
    >
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
        <span
          aria-hidden
          className="ml-1 inline-block transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
    </Link>
  );
}
