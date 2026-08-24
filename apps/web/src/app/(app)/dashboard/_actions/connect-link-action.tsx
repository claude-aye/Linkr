'use client';

import { useState } from 'react';

/**
 * Mints a Stripe Account Link and sends the provider to it.
 *
 *   kind="onboard"      → POST /api/service-providers/{id}/connect/onboard
 *   kind="refresh-link" → POST /api/service-providers/{id}/connect/refresh-link
 *
 * Both answer `{ url, expiresAt }`; we navigate to `url`.
 *
 * ⚠️ READING THE BODY HERE IS NOT A BREAK OF THE 3.12b LOCK. That rule says the
 * FR message is chosen by HTTP STATUS ALONE — the body is never consulted to
 * decide what to say. It says nothing about the payload a successful call exists
 * to deliver: the link IS the response. The error path below never looks at the
 * body.
 *
 * `pending` stays true across the navigation, deliberately: Account Links are
 * single-use and short-lived, so a second click would burn a fresh one for
 * nothing. Same reasoning as `/providers/new` keeping its button disabled while
 * the redirect is in flight.
 */
export interface ConnectLinkActionProps {
  providerId: string;
  kind: 'onboard' | 'refresh-link';
  label: string;
  /** `primary` = the band's call to action; `link` = the discreet footer form. */
  variant: 'primary' | 'link';
}

const UNEXPECTED_MESSAGE =
  'Une erreur inattendue est survenue. Veuillez réessayer plus tard.';

/** Stripe refused (rejected account, platform profile incomplete, outage…). */
const UPSTREAM_MESSAGE =
  'Stripe est momentanément indisponible. Veuillez réessayer plus tard.';

const NOT_FOUND_MESSAGE =
  'Votre compte de paiement est introuvable. Veuillez rafraîchir la page.';

const SESSION_MESSAGE =
  'Votre session a expiré. Veuillez vous reconnecter.';

/**
 * Locked mapping: by HTTP status ALONE, never by parsing the error body.
 *
 * 502 is the one that matters and the one that is NOT generic — it is what a
 * `DISABLED` account's retry returns, and what the seeded fixture account
 * returns by construction (its Stripe id is deliberately malformed, so Stripe
 * has no such account). Calling that « une erreur inattendue » would be a lie:
 * it is Stripe answering, not us failing.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      return SESSION_MESSAGE;
    case 404:
      return NOT_FOUND_MESSAGE;
    case 502:
      return UPSTREAM_MESSAGE;
    default:
      return UNEXPECTED_MESSAGE;
  }
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export function ConnectLinkAction({
  providerId,
  kind,
  label,
  variant,
}: ConnectLinkActionProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    setError(null);
    setPending(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/service-providers/${providerId}/connect/${kind}`,
        { method: 'POST' },
      );
    } catch {
      setError(UNEXPECTED_MESSAGE);
      setPending(false);
      return;
    }

    if (!response.ok) {
      setError(messageForStatus(response.status));
      setPending(false);
      return;
    }

    let url: unknown;
    try {
      url = ((await response.json()) as { url?: unknown }).url;
    } catch {
      url = undefined;
    }

    // A 2xx without a usable link is not a success we can act on. Say so rather
    // than navigating nowhere.
    if (typeof url !== 'string' || url === '') {
      setError(UNEXPECTED_MESSAGE);
      setPending(false);
      return;
    }

    // Full-page navigation to Stripe's domain — `router.push` handles in-app
    // routes only. `pending` is intentionally left true (see the header).
    window.location.assign(url);
  }

  const className =
    variant === 'primary'
      ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60'
      : 'inline-flex items-center gap-2 text-sm font-medium text-blue-600 underline-offset-2 transition hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-blue-400';

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        className={className}
      >
        {pending && <Spinner />}
        {label}
      </button>

      {error && (
        <p
          role="alert"
          className="max-w-sm rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
