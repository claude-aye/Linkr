'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { retryAfterMessage } from '@/lib/http/retry-after';
import {
  NETWORK_MESSAGE,
  RESEND_BUTTON_LABEL,
  RESEND_BUTTON_PENDING_LABEL,
  RESEND_BUTTON_SENT_LABEL,
  resendOutcome,
} from '@/lib/email-verification/states';

/**
 * Sending the confirmation email (mandate A). Sign-up sends nothing: the first
 * mail, like every later one, is asked for here, by a click. One hook for the
 * two places that offer the button — the `(app)` shell band and the notice
 * shown inside a modal that covers that band (`EmailNotVerifiedNotice`) — so
 * their states and messages cannot drift.
 *
 * The answer is read from the status code, and from `{ code }` for the two 503
 * causes (see `lib/email-verification/states`). ALREADY_VERIFIED refreshes the
 * server data, which unmounts the band.
 */
export function useResendVerification() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/email-verification/resend', { method: 'POST' });
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        code?: string;
      } | null;
      const outcome = resendOutcome(res.status, res.status === 200 ? body?.status : body?.code);
      if (outcome.kind === 'rate-limited') {
        setError(`Trop de demandes. ${retryAfterMessage(res.headers.get('Retry-After'))}`);
      } else if (outcome.kind === 'sent') {
        setSent(true);
        setStatus(outcome.message);
      } else if (outcome.kind === 'already-verified') {
        setStatus(outcome.message);
        router.refresh();
      } else {
        setError(outcome.message);
      }
    } catch {
      setError(NETWORK_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return { pending, sent, status, error, send };
}

type ResendState = ReturnType<typeof useResendVerification>;

/** The button itself: 44 px, label by state. */
export function ResendVerificationButton({ state }: { state: ResendState }) {
  return (
    <button
      type="button"
      onClick={state.send}
      disabled={state.pending}
      className="inline-flex min-h-11 items-center rounded-2xl font-medium text-accent underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
    >
      {state.pending
        ? RESEND_BUTTON_PENDING_LABEL
        : state.sent
          ? RESEND_BUTTON_SENT_LABEL
          : RESEND_BUTTON_LABEL}
    </button>
  );
}

/**
 * Errors (rate limit, saturated day, outage). Present in the DOM even when
 * empty: a live region inserted together with its content is often not
 * announced.
 */
export function ResendVerificationError({ state }: { state: ResendState }) {
  return (
    <p role="alert" aria-live="assertive" className="text-red-700">
      {state.error}
    </p>
  );
}

/**
 * The L3 403 shown INSIDE a modal that covers the shell band (the add-card
 * dialog of `/account/payment-methods`): the band's button cannot be reached
 * there, so the notice carries the same button. Everywhere else the 403
 * message points to the band instead, and no form gets a button of its own.
 */
export function EmailNotVerifiedNotice({ text }: { text: string }) {
  const state = useResendVerification();
  return (
    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p role="status" aria-live="polite">
        {state.status ?? text}
      </p>
      <ResendVerificationButton state={state} />
      <ResendVerificationError state={state} />
    </div>
  );
}
