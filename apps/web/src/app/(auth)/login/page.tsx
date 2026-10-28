'use client';

import { type FormEvent, Suspense, useState } from 'react';

import { ResetSuccessNotice } from './reset-success-notice';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      // ⚠️ THE 429 IS BRANCHED BEFORE THE CATCH-ALL, AND IT IS NOT A DETAIL.
      // Folded into « identifiants invalides » it would tell someone whose
      // password is perfectly correct that it is wrong — sending them to reset a
      // password that never needed resetting. The budget is per address and the
      // guard raises it before any lookup, so this says nothing about the
      // account. Mapping is by HTTP status ALONE (convention locked since
      // 3.12b): the body is never parsed to pick a message.
      if (res.status === 429) {
        setError(tooManyAttemptsMessage(res));
        return;
      }

      if (!res.ok) {
        setError('Identifiants invalides. Veuillez vérifier votre courriel et votre mot de passe.');
        return;
      }

      // Cookies are now set (httpOnly); land on the authenticated client hub.
      router.push('/');
      router.refresh();
    } catch {
      setError('Connexion impossible. Veuillez réessayer plus tard.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={authCardClass}>
      <header className="mb-6">
        <h1 className={authTitleClass}>
          Connexion
        </h1>
        <p className={authSubtitleClass}>
          Accédez à votre portail Linkr.
        </p>
      </header>

      {/* Shown after a successful reset (A-2.21: no auto-login, so the user
          lands here and needs to be told the change worked). Suspense is
          required by `useSearchParams()` and is what keeps /login static. */}
      <Suspense fallback={null}>
        <ResetSuccessNotice />
      </Suspense>

      {/* `method="post"` n'est pas décoratif : sans lui, une soumission qui
          part avant l'hydratation encode les champs dans la query string.
          Voir la règle no-restricted-syntax du bloc (auth) dans
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
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={authFieldClass}
          />
        </div>

        <div>
          <label htmlFor="password" className={authLabelClass}>
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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
          {submitting ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>

      <p className={authFooterTextClass}>
        <Link
          href="/forgot-password"
          className={authStandaloneLinkClass}
        >
          Mot de passe oublié?
        </Link>
      </p>

      <p className={authFooterTextClass}>
        Vous n’avez pas de compte?{' '}
        <Link
          href="/signup"
          className={authStandaloneLinkClass}
        >
          Créer un compte
        </Link>
      </p>
    </section>
  );
}
