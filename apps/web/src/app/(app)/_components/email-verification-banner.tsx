'use client';

import {
  ResendVerificationButton,
  ResendVerificationError,
  useResendVerification,
} from '@/components/email-verification/resend-verification';
import { BANNER_LEAD } from '@/lib/email-verification/states';

/**
 * « Adresse courriel non confirmée » band of the `(app)` shell (L2, mandate A).
 *
 * Rendered by the layout ONLY for a signed-in user whose `emailVerified` is
 * false, so it is part of the server HTML: no flash while data loads. It blocks
 * nothing and links nowhere.
 *
 * ⚠️ MANDATE A: sign-up sends NOTHING. This band's button is how the first
 * confirmation email is asked for. States: initial (lead + « Envoyer le
 * courriel de confirmation »), sending, sent (« Courriel envoyé, vérifiez
 * votre boîte. »), refused (rate limit or saturated day, in the alert region).
 * The L3 403 message of the guarded forms points here.
 */
export function EmailVerificationBanner() {
  const state = useResendVerification();

  return (
    <div className="border-b border-edge bg-surface px-4 py-2 text-sm text-text sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* Polite region, always present: the lead is replaced by the outcome. */}
        <p role="status" aria-live="polite">
          {state.status ?? BANNER_LEAD}
        </p>
        <ResendVerificationButton state={state} />
        <ResendVerificationError state={state} />
      </div>
    </div>
  );
}
