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
    return { kind: 'sent', message: 'Courriel envoyé.' };
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
