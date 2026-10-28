'use client';

import { type FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  authButtonClass,
  authCardClass,
  authErrorBannerClass,
  authFieldClass,
  authFooterTextClass,
  authHintClass,
  authInlineLinkClass,
  authLabelClass,
  authStandaloneLinkClass,
  authSubtitleClass,
  authTitleClass,
} from '../_styles';

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

  return (
    <section className={authCardClass}>
      <header className="mb-6">
        <h1 className={authTitleClass}>
          Nouveau mot de passe
        </h1>
        <p className={authSubtitleClass}>
          Choisissez un nouveau mot de passe pour votre compte Linkr.
        </p>
      </header>

      {token === null ? (
        <>
          <p
            role="alert"
            className={authErrorBannerClass}
          >
            Ce lien est incomplet. Veuillez demander un nouveau lien de
            réinitialisation.
          </p>
          <p className={authFooterTextClass}>
            <Link
              href="/forgot-password"
              className={authStandaloneLinkClass}
            >
              Demander un nouveau lien
            </Link>
          </p>
        </>
      ) : (
        <form method="post" onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="password" className={authLabelClass}>
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
              className={authFieldClass}
              aria-describedby="password-hint"
            />
            <p
              id="password-hint"
              className={authHintClass}
            >
              Au moins {PASSWORD_MIN} caractères.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className={authErrorBannerClass}
            >
              {error}{' '}
              <Link
                href="/forgot-password"
                className={authInlineLinkClass}
              >
                Demander un nouveau lien.
              </Link>
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={authButtonClass}
          >
            {submitting ? 'Enregistrement…' : 'Changer mon mot de passe'}
          </button>
        </form>
      )}
    </section>
  );
}
