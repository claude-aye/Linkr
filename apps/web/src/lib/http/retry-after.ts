/**
 * Turns a `Retry-After` into something a person can act on (chantier B).
 *
 * ⚠️ A LIMITER THAT BLOCKS WITHOUT SAYING WHY LOOKS EXACTLY LIKE AN OUTAGE — and
 * the only people who ever see it are the legitimate ones, since an attacker
 * neither reads nor believes the screen. Saying HOW LONG is what turns a dead
 * end into an instruction.
 *
 * The header is a whole number of seconds (never an HTTP date) — `RateLimitGuard`
 * writes `Math.ceil` of the remaining window. It is same-origin, so the browser
 * lets the page read it; nothing here depends on that being true, though, since
 * a missing or unreadable value simply falls back to the vaguer sentence.
 *
 * Rounds UP: telling someone to come back a minute early only earns them a
 * second refusal.
 */
export function retryAfterMessage(header: string | null): string {
  const seconds = Number(header);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    // Nothing credible to quote — say to wait without inventing a number.
    return 'Veuillez patienter quelques minutes avant de réessayer.';
  }

  if (seconds < 60) {
    return 'Veuillez réessayer dans moins d’une minute.';
  }

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `Veuillez réessayer dans environ ${minutes} minute${minutes > 1 ? 's' : ''}.`;
  }

  const hours = Math.ceil(minutes / 60);
  return `Veuillez réessayer dans environ ${hours} heure${hours > 1 ? 's' : ''}.`;
}

/**
 * The full sentence shown when a budget is spent: what happened, then what to
 * do. Kept in one place so the three auth screens cannot drift apart on the one
 * message a user is most likely to hit while doing nothing wrong.
 */
export function tooManyAttemptsMessage(response: Response): string {
  return `Trop de tentatives depuis votre appareil. ${retryAfterMessage(
    response.headers.get('Retry-After'),
  )}`;
}
