'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { retryAfterMessage } from '@/lib/http/retry-after';
import {
  INVALID_LINK_MESSAGE,
  NETWORK_MESSAGE,
  NO_TOKEN_MESSAGE,
  verifyOutcome,
} from '@/lib/email-verification/states';
import {
  authButtonClass,
  authCardClass,
  authErrorBannerClass,
  authFooterTextClass,
  authStandaloneLinkClass,
  authSubtitleClass,
  authSuccessBannerClass,
  authTitleClass,
} from '../_styles';

type View =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success' }
  | { kind: 'error'; text: string };

/**
 * The token is stripped from the address bar on mount, as on `/reset-password`:
 * a live credential in `location.href` leaks into history, screenshots and the
 * `Referer` of whatever the page loads. `replaceState`, so Back does not walk
 * onto the URL that was just cleaned. It already arrived as a prop, so the
 * effect touches history only and sets no state.
 *
 * No `<form>` here on purpose: nothing is typed, and a native submission before
 * hydration would have nowhere useful to go. The button does nothing until the
 * page is interactive.
 */
export function VerifyEmailCard({
  token,
  signedIn,
}: {
  token: string | null;
  signedIn: boolean;
}) {
  const [view, setView] = useState<View>({ kind: 'idle' });

  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('token')) return;
    params.delete('token');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    );
  }, [token]);

  async function confirm() {
    if (!token || view.kind === 'pending') return;
    setView({ kind: 'pending' });
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const outcome = verifyOutcome(res.status);
      switch (outcome.kind) {
        case 'success':
          setView({ kind: 'success' });
          return;
        case 'invalid':
          setView({ kind: 'error', text: INVALID_LINK_MESSAGE });
          return;
        case 'rate-limited':
          setView({
            kind: 'error',
            text: `Trop de tentatives. ${retryAfterMessage(res.headers.get('Retry-After'))}`,
          });
          return;
        default:
          setView({ kind: 'error', text: NETWORK_MESSAGE });
      }
    } catch {
      setView({ kind: 'error', text: NETWORK_MESSAGE });
    }
  }

  const done = view.kind === 'success';

  return (
    <section className={authCardClass}>
      <header className="mb-6">
        <h1 className={authTitleClass}>Confirmer votre adresse</h1>
        <p className={authSubtitleClass}>
          {done
            ? 'Votre adresse courriel est confirmée.'
            : 'Une dernière étape pour confirmer l’adresse de votre compte Linkr.'}
        </p>
      </header>

      {token === null ? (
        <p role="alert" className={authErrorBannerClass}>
          {NO_TOKEN_MESSAGE}
        </p>
      ) : done ? (
        <p role="status" className={authSuccessBannerClass}>
          Merci, c’est fait.
        </p>
      ) : (
        <>
          {view.kind === 'error' && (
            <p role="alert" className={`${authErrorBannerClass} mb-4`}>
              {view.text}
            </p>
          )}
          <button
            type="button"
            onClick={confirm}
            disabled={view.kind === 'pending'}
            className={authButtonClass}
          >
            {view.kind === 'pending' ? 'Confirmation…' : 'Confirmer mon adresse'}
          </button>
        </>
      )}

      <p className={authFooterTextClass}>
        {done || token === null || view.kind === 'error' ? (
          <Link
            href={signedIn ? '/' : '/login'}
            className={authStandaloneLinkClass}
          >
            {signedIn ? 'Aller à l’accueil' : 'Se connecter'}
          </Link>
        ) : null}
      </p>
    </section>
  );
}
