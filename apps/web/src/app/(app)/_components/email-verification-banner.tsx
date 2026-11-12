'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { retryAfterMessage } from '@/lib/http/retry-after';
import { NETWORK_MESSAGE, resendOutcome } from '@/lib/email-verification/states';

/** Set by `/signup` after a successful sign-up; read once for the opening sentence. */
export const JUST_SIGNED_UP_PARAM = 'courriel';
export const JUST_SIGNED_UP_VALUE = 'envoye';

/**
 * « Confirmez votre adresse » band of the `(app)` shell (L2).
 *
 * Rendered by the layout ONLY for a signed-in user whose `emailVerified` is
 * false, so it is part of the server HTML: no flash while data loads. It blocks
 * nothing and links nowhere. It makes no promise about delivery.
 *
 * The resend answer is read from the status code, and from `{ code }` for the
 * two 503 causes, whose sentences differ (see `lib/email-verification/states`).
 * ALREADY_VERIFIED refreshes the server data, which unmounts this band.
 */
export function EmailVerificationBanner() {
  return (
    <Suspense fallback={<Band lead={DEFAULT_LEAD} />}>
      <WithSignupFlag />
    </Suspense>
  );
}

const DEFAULT_LEAD = 'Confirmez votre adresse courriel. Vérifiez vos indésirables, puis';

function WithSignupFlag() {
  const params = useSearchParams();
  const justSignedUp = params.get(JUST_SIGNED_UP_PARAM) === JUST_SIGNED_UP_VALUE;
  return (
    <Band
      lead={
        justSignedUp
          ? 'Nous avons envoyé un courriel de confirmation à votre adresse. Vérifiez vos indésirables, puis'
          : DEFAULT_LEAD
      }
    />
  );
}

function Band({ lead }: { lead: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function resend() {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch('/api/email-verification/resend', { method: 'POST' });
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        code?: string;
      } | null;
      const outcome = resendOutcome(res.status, res.status === 200 ? body?.status : body?.code);
      if (outcome.kind === 'rate-limited') {
        setIsError(true);
        setMessage(`Trop de demandes. ${retryAfterMessage(res.headers.get('Retry-After'))}`);
      } else {
        setIsError(outcome.kind === 'error' || outcome.kind === 'reauth');
        setMessage(outcome.message);
        if (outcome.kind === 'already-verified') router.refresh();
      }
    } catch {
      setIsError(true);
      setMessage(NETWORK_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-b border-edge bg-surface px-4 py-2 text-sm text-text sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p>
          {lead}{' '}
          <button
            type="button"
            onClick={resend}
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-2xl font-medium text-accent underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
          >
            {pending ? 'Envoi…' : 'Renvoyer le courriel'}
          </button>
          .
        </p>
        {/* Present in the DOM even when empty: a live region inserted together
            with its content is often not announced. */}
        <p
          role={isError ? 'alert' : 'status'}
          aria-live={isError ? 'assertive' : 'polite'}
          className={isError ? 'text-red-700' : 'text-text-muted'}
        >
          {message}
        </p>
      </div>
    </div>
  );
}
