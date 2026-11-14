/**
 * Maps the API's answers about email confirmation to screen states (L2).
 *
 * Pure and import-free (`node --test` loads it as is). Mapping is by HTTP
 * status, plus the `code` of a 503 body — the one place a body is read, because
 * the two 503 causes of the resend need different sentences and the status
 * cannot tell them apart.
 */

export type VerifyOutcome =
  | { kind: 'success' }
  /** One message for unknown, expired, used or replaced: the page says nothing about the token. */
  | { kind: 'invalid' }
  | { kind: 'rate-limited' }
  | { kind: 'network' };

export function verifyOutcome(status: number): VerifyOutcome {
  if (status === 204) return { kind: 'success' };
  // 400 covers both the coded "invalid token" and a malformed body: neither is
  // something the reader can tell apart, nor should the page try to.
  if (status === 400) return { kind: 'invalid' };
  if (status === 429) return { kind: 'rate-limited' };
  return { kind: 'network' };
}

export const INVALID_LINK_MESSAGE =
  'Ce lien est invalide ou expiré. Connectez-vous et demandez un nouveau courriel.';
export const NETWORK_MESSAGE =
  'Service momentanément indisponible. Veuillez réessayer.';
export const NO_TOKEN_MESSAGE =
  'Ce lien est incomplet. Connectez-vous et demandez un nouveau courriel de confirmation.';

/**
 * Mandate A: sign-up sends nothing; the band's button sends the first email.
 * Shared by the band and by `EmailNotVerifiedNotice`.
 */
export const BANNER_LEAD = 'Votre adresse courriel n’est pas confirmée.';
export const SENT_MESSAGE = 'Courriel envoyé, vérifiez votre boîte.';
export const RESEND_BUTTON_LABEL = 'Envoyer le courriel de confirmation';
export const RESEND_BUTTON_PENDING_LABEL = 'Envoi en cours…';
export const RESEND_BUTTON_SENT_LABEL = 'Renvoyer le courriel';

export type ResendOutcome =
  | { kind: 'sent'; message: string }
  | { kind: 'already-verified'; message: string }
  | { kind: 'rate-limited' }
  | { kind: 'reauth'; message: string }
  | { kind: 'error'; message: string };

/** `code` is read from the 503 body by the caller; anything else is `undefined`. */
export function resendOutcome(status: number, code: string | undefined): ResendOutcome {
  if (status === 200) {
    // Caller passes code = the body's `status` field for a 200.
    if (code === 'ALREADY_VERIFIED') {
      return { kind: 'already-verified', message: 'Votre adresse est déjà confirmée.' };
    }
    return { kind: 'sent', message: SENT_MESSAGE };
  }
  if (status === 429) return { kind: 'rate-limited' };
  if (status === 401) {
    return { kind: 'reauth', message: 'Votre session a expiré. Veuillez vous reconnecter.' };
  }
  if (status === 503) {
    if (code === 'EMAIL_VERIFICATION_BUDGET_EXHAUSTED') {
      return { kind: 'error', message: 'Les envois sont saturés aujourd’hui, réessayez demain.' };
    }
    if (code === 'EMAIL_VERIFICATION_SEND_FAILED') {
      return { kind: 'error', message: 'L’envoi a échoué, réessayez dans un moment.' };
    }
  }
  return { kind: 'error', message: NETWORK_MESSAGE };
}

/** The signup 503 with a code is its own sentence; everything else keeps the generic mapping. */
export const SIGNUP_BUDGET_MESSAGE = 'Les inscriptions sont saturées aujourd’hui, réessayez demain.';
export const SIGNUP_BUDGET_CODE = 'EMAIL_VERIFICATION_BUDGET_EXHAUSTED';

/**
 * L3 — a 403 whose body carries this code means "confirm your address first".
 * Read ONLY on the forms of the guarded actions, and only on a 403: everywhere
 * else the mapping stays by status alone (lock 3.12b). A 403 WITHOUT this code
 * keeps the form's existing message, strictly.
 */
export const EMAIL_NOT_VERIFIED_CODE = 'EMAIL_NOT_VERIFIED';
/**
 * Mandate A: the message points to the shell band, whose button sends the
 * email; the forms get no button of their own. The band is rendered by
 * `(app)/layout.tsx` on every page of the guarded forms. The one place it is
 * covered (the add-card modal) shows `EmailNotVerifiedNotice` instead, with
 * EMAIL_NOT_VERIFIED_IN_DIALOG_MESSAGE.
 */
export const EMAIL_NOT_VERIFIED_MESSAGE =
  'Confirmez votre adresse courriel pour effectuer cette action. Utilisez le bouton « Envoyer le courriel de confirmation » du bandeau en haut de la page.';
export const EMAIL_NOT_VERIFIED_IN_DIALOG_MESSAGE =
  'Confirmez votre adresse courriel pour enregistrer une carte.';

/**
 * True when the response is the L3 403. Reads a CLONE of the body, and only on
 * a 403, so the caller can still read it; an unreadable body is not the code.
 */
export async function isEmailNotVerified(response: {
  status: number;
  clone(): { json(): Promise<unknown> };
}): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const body = await response.clone().json();
    return (
      typeof body === 'object' &&
      body !== null &&
      (body as { code?: unknown }).code === EMAIL_NOT_VERIFIED_CODE
    );
  } catch {
    return false;
  }
}

/**
 * L3b-B — message for a failed `POST /payment-methods/setup-intent`. Only the
 * 403 carrying `EMAIL_NOT_VERIFIED` gets the dedicated message; a 403 without
 * that code keeps the generic one, and 401 keeps its own.
 */
export async function setupIntentErrorMessage(
  response: { status: number; clone(): { json(): Promise<unknown> } },
  messages: { generic: string; sessionExpired: string },
): Promise<string> {
  if (await isEmailNotVerified(response)) return EMAIL_NOT_VERIFIED_MESSAGE;
  return response.status === 401 ? messages.sessionExpired : messages.generic;
}
