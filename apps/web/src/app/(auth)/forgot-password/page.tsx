'use client';

import { type FormEvent, useState } from 'react';
import Link from 'next/link';

import { tooManyAttemptsMessage } from '@/lib/http/retry-after';
import {
  authButtonClass,
  authCardClass,
  authErrorBannerClass,
  authFieldClass,
  authFooterTextClass,
  authLabelClass,
  authStandaloneLinkClass,
  authSubtitleClass,
  authTitleClass,
} from '../_styles';

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

  return (
    <section className={authCardClass}>
      {submitted ? (
        <>
          <header className="mb-4">
            <h1 className={authTitleClass}>
              Vérifiez vos courriels
            </h1>
          </header>
          <p className="text-sm text-text">
            Si un compte existe pour <strong>{email.trim()}</strong>, vous
            recevrez un lien de réinitialisation dans quelques instants.
          </p>
          <p className="mt-3 text-sm text-text-muted">
            Le lien est valide 60 minutes et ne peut servir qu&apos;une seule
            fois. Pensez à regarder dans vos indésirables.
          </p>
          <p className={authFooterTextClass}>
            <Link
              href="/login"
              className={authStandaloneLinkClass}
            >
              Retour à la connexion
            </Link>
          </p>
        </>
      ) : (
        <>
          <header className="mb-6">
            <h1 className={authTitleClass}>
              Mot de passe oublié
            </h1>
            <p className={authSubtitleClass}>
              Saisissez votre courriel : nous vous enverrons un lien pour
              choisir un nouveau mot de passe.
            </p>
          </header>

          {/* `method="post"` n'est pas décoratif : sans lui, une soumission
              qui part avant l'hydratation encode les champs dans la query
              string. Voir la règle no-restricted-syntax du bloc (auth) dans
              eslint.config.mjs. */}
          <form method="post" onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className={authLabelClass}>
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
                className={authFieldClass}
              />
            </div>

            {error && (
              <p
                role="alert"
                className={authErrorBannerClass}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className={authButtonClass}
            >
              {submitting ? 'Envoi…' : 'Envoyer le lien'}
            </button>
          </form>

          <p className={authFooterTextClass}>
            Vous vous en souvenez?{' '}
            <Link
              href="/login"
              className={authStandaloneLinkClass}
            >
              Se connecter
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
