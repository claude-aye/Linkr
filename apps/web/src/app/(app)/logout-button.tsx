'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Logout is idempotent — redirect to /login regardless of the result.
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={pending}
      className="flex min-h-11 items-center rounded-lg border border-edge px-4 text-sm font-medium text-text transition-colors hover:bg-text/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
    >
      {pending ? 'Déconnexion…' : 'Déconnexion'}
    </button>
  );
}
