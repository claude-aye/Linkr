'use client';

import { type FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * The reset form. Receives the token as a prop — see the page's docblock.
 *
 * ⚠️ THE TOKEN IS STRIPPED FROM THE ADDRESS BAR ON MOUNT (A-2.19). A live
 * credential sitting in `location.href` leaks in more ways than it looks:
 * browser history, session restore, a screenshot, a shoulder, and the `Referer`
 * of anything the page loads. `history.replaceState` — not `push` — so Back does
 * not walk the user onto the URL that was just cleaned.
 *
 * The effect touches the browser's history and nothing else. It deliberately
 * does NOT set state: the token already arrived as a prop, so there is nothing
 * to derive, and the URL rewrite is a genuine external-system sync rather than a
 * render input.
 *
 * The complementary half is `Referrer-Policy: no-referrer`, set on this route in
 * `next.config.ts` — it covers the window before this effect runs. Neither
 * replaces the other.
 *
 * ⚠️ THE SAME REASONING COVERS THE `<form>` TAG, WHICH IS WHY IT CARRIES
 * `method="post"`. Everything above strips a credential the URL should never
 * have held — but a submission that fires BEFORE hydration would put a fresh
 * `password=…` right back into that same URL, by the browser's own default. The
 * defence was one attribute short of complete. The POST does not make the
 * native submission work (it lands on a 405); it turns a silent leak into a
 * visible failure. Enforced by the (auth) block in `eslint.config.mjs`.
 */

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/**
 * Maps the BFF status to frozen French copy. By HTTP status ALONE — the body is
 * never parsed to pick a message (convention locked since 3.12b). Vouvoiement.
 */
function errorForStatus(status: number): string {
  switch (status) {
    case 400:
      // The API collapses unknown / expired / consumed / rotated into this one
      // case. Rotation is named first because asking twice and clicking the
      // older mail is the common way to get here, and it is the only part the
      // reader can act on (A-2.20).
      return 'Ce lien a été remplacé ou a expiré. Veuillez demander un nouveau lien de réinitialisation.';
    default:
      return 'Service momentanément indisponible. Veuillez réessayer.';
  }
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('token')) return;

    // Strip it, keeping everything else about the location intact.
    params.delete('token');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    );
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token) return;
    if (password.length < PASSWORD_MIN) {
      setError(
        `Le mot de passe doit contenir au moins ${PASSWORD_MIN} caractères.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      if (!res.ok) {
        setError(errorForStatus(res.status));
        return;
      }

      // No auto-login (A-2.21). `?reset=1` is what makes the sign-in page show
      // its success notice — the token is long gone by now.
      router.push('/login?reset=1');
    } catch {
      setError('Service momentanément indisponible. Veuillez réessayer.');
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800';
  const labelClass = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300';

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Nouveau mot de passe
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Choisissez un nouveau mot de passe pour votre compte Linkr.
          </p>
        </header>

        {token === null ? (
          <>
            <p
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              Ce lien est incomplet. Veuillez demander un nouveau lien de
              réinitialisation.
            </p>
            <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              <Link
                href="/forgot-password"
                className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
              >
                Demander un nouveau lien
              </Link>
            </p>
          </>
        ) : (
          <form method="post" onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="password" className={labelClass}>
                Nouveau mot de passe
              </label>
              <input
                id="password"
                name="password"
                type="password"
                // `new-password`, so managers offer a generated one instead of
                // autofilling the credential being replaced.
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN}
                maxLength={PASSWORD_MAX}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={fieldClass}
                aria-describedby="password-hint"
              />
              <p
                id="password-hint"
                className="mt-1 text-xs text-zinc-500 dark:text-zinc-400"
              >
                Au moins {PASSWORD_MIN} caractères.
              </p>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              >
                {error}{' '}
                <Link
                  href="/forgot-password"
                  className="font-medium underline underline-offset-2"
                >
                  Demander un nouveau lien.
                </Link>
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {submitting ? 'Enregistrement…' : 'Changer mon mot de passe'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
