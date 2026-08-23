'use client';

import { useSearchParams } from 'next/navigation';

/**
 * "Your password was changed" — shown on the sign-in page after a reset.
 *
 * ⚠️ ITS OWN COMPONENT, READING `useSearchParams()`, FOR A REASON THAT COST A
 * ROUND TO FIND. The obvious version — a `useState` initialiser reading
 * `window.location.search` on the sign-in page — DOES NOT WORK: `/login` is
 * statically prerendered, so the initialiser sees no `window` on the server and
 * a real query string on the client. The two renders disagree, and React
 * resolves that in the server's favour: the banner silently never appears
 * (measured at the browser — the redirect carried `?reset=1` and nothing showed).
 *
 * `useSearchParams()` is the supported way to read a query string on a
 * prerendered page. It requires a Suspense boundary — supplied by the caller —
 * which is what lets `/login` stay static while this one fragment resolves on
 * the client.
 *
 * `role="status"` rather than `role="alert"`: this is good news, and a polite
 * live region does not interrupt a screen reader mid-sentence. `alert` stays the
 * convention for errors.
 */
export function ResetSuccessNotice() {
  const params = useSearchParams();
  if (params.get('reset') !== '1') return null;

  return (
    <p
      role="status"
      className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
    >
      Votre mot de passe a été changé. Connectez-vous avec votre nouveau mot de
      passe.
    </p>
  );
}
