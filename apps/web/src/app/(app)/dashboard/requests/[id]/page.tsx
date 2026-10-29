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
    <main className="flex flex-1 items-center justify-center bg-bg p-6">
      <section className="w-full max-w-xl rounded-2xl border border-edge bg-surface p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-text">
          Vue détail — Phase B
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          La vue complète de la demande (et les actions Accepter / Refuser)
          arrive dans une prochaine phase.
        </p>
        <p className="mt-4 font-mono text-xs text-text-muted">{id}</p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          ← Retour au tableau de bord
        </Link>
      </section>
    </main>
  );
}
