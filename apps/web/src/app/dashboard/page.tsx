import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/session';

import { LogoutButton } from './logout-button';

// Reads the access cookie (a request-time API) — always rendered per request.
export const dynamic = 'force-dynamic';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-100 py-2 last:border-0 dark:border-zinc-800">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-right font-medium text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();

  // Basic local guard (the generic route-protection middleware lands in 3.11b-2).
  // `redirect` throws, so it is called outside any try/catch.
  if (!user) {
    redirect('/login');
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Tableau de bord
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Tu es connecté·e.
            </p>
          </div>
          <LogoutButton />
        </header>

        <dl className="text-sm">
          <Field label="Nom" value={user.displayName ?? (fullName || '—')} />
          <Field label="Courriel" value={user.email} />
          <Field label="Niveau de vérification" value={user.verificationLevel} />
          <Field label="Langue" value={user.languagePreference} />
          <Field
            label="Région"
            value={`${user.countryCode} · ${user.subdivisionCode}`}
          />
        </dl>
      </section>
    </main>
  );
}
