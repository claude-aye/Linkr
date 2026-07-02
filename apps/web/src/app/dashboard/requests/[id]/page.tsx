import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/session';

// Reads the access cookie — always rendered per request.
export const dynamic = 'force-dynamic';

/**
 * Minimal detail stub so the dashboard's « Voir le détail » link never 404s.
 * The REAL detail view — and the Accepter / Refuser transition actions — is
 * phase B, deliberately out of this read-only slice.
 */
export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Same defence-in-depth page gate as the dashboard (the proxy only checks
  // cookie presence). `redirect` throws, so it stays outside any try/catch.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const { id } = await params;

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Vue détail — Phase B
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          La vue complète de la demande (et les actions Accepter / Refuser)
          arrive dans une prochaine phase.
        </p>
        <p className="mt-4 font-mono text-xs text-zinc-400 dark:text-zinc-500">{id}</p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
        >
          ← Retour au tableau de bord
        </Link>
      </section>
    </main>
  );
}
