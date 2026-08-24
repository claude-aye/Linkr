'use client';

import { type FormEvent, useState } from 'react';
import Link from 'next/link';

import { tooManyAttemptsMessage } from '@/lib/http/retry-after';

/**
 * Request a password reset link (`/forgot-password`).
 *
 * Structure, styles and state handling are the sign-in page's, deliberately: the
 * auth screens are siblings and a user should not feel they have left the
 * building.
 *
 * ⚠️ SUCCESS SAYS "IF AN ACCOUNT EXISTS", AND THAT WORDING IS THE WHOLE POINT.
 * The API answers 202 for every address, existing or not (A-2.12), so this
 * screen must not claim more than it knows. Copy that said « un courriel vous a
 * été envoyé » would be a lie half the time — and, worse, a screen that ever
 * said anything else would turn this page into an account-existence oracle. The
 * conditional phrasing is what lets the confirmation be honest AND constant.
 */
const EMAIL_MAX = 255;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Veuillez saisir votre courriel.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      // ⚠️ THE 429 IS THE ONE THING THE RELAY LETS THROUGH, AND ONLY THE ONE
      // FROM THE IP BUDGET. It is raised before the address is looked at, so it
      // cannot say whether an account exists. The OTHER cap — five sends an hour
      // per address — never reaches here: it suppresses the mail and still
      // answers 202, precisely because it CAN only be reached by an address that
      // exists. Surfacing that one would be the oracle this page is built to
      // deny. Do not merge the two.
      if (res.status === 429) {
        setError(tooManyAttemptsMessage(res));
        return;
      }

      // The relay collapses everything else to 202 — including an unreachable
      // API — so in practice only a malformed request lands here.
      if (!res.ok) {
        setError('Certains champs sont invalides. Veuillez les vérifier.');
        return;
      }

      setSubmitted(true);
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
        {submitted ? (
          <>
            <header className="mb-4">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Vérifiez vos courriels
              </h1>
            </header>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Si un compte existe pour <strong>{email.trim()}</strong>, vous
              recevrez un lien de réinitialisation dans quelques instants.
            </p>
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
              Le lien est valide 60 minutes et ne peut servir qu&apos;une seule
              fois. Pensez à regarder dans vos indésirables.
            </p>
            <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              <Link
                href="/login"
                className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
              >
                Retour à la connexion
              </Link>
            </p>
          </>
        ) : (
          <>
            <header className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Mot de passe oublié
              </h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Saisissez votre courriel : nous vous enverrons un lien pour
                choisir un nouveau mot de passe.
              </p>
            </header>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="email" className={labelClass}>
                  Courriel
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={EMAIL_MAX}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={fieldClass}
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {submitting ? 'Envoi…' : 'Envoyer le lien'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Vous vous en souvenez?{' '}
              <Link
                href="/login"
                className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
              >
                Se connecter
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
