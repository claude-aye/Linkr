/**
 * The reason a mail job failed, safe to write to a log (L1b, CLAUDE.md §13 nº 19).
 *
 * A relay refusal echoes the recipient back ("550 5.1.1 <x@y>: Recipient
 * address rejected"), and Nodemailer copies it into `error.message`. Logging
 * the message as is would put an address in the Docker logs, which rotate by
 * size and keep it for months.
 *
 * So: when the error carries an SMTP reply code (Nodemailer's `responseCode`)
 * only the codes are kept; otherwise the message is kept with every
 * `<…>` group and every address-like token replaced.
 */
const ANGLE_GROUP = /<[^>]*>/g;
const ADDRESS_LIKE = /[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g;

export function safeSmtpReason(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'unknown error';
  }
  const e = error as { responseCode?: unknown; code?: unknown; message?: unknown };

  if (typeof e.responseCode === 'number') {
    const code = typeof e.code === 'string' && /^[A-Z_]+$/.test(e.code) ? ` ${e.code}` : '';
    return `SMTP ${e.responseCode}${code}`;
  }

  const message = typeof e.message === 'string' ? e.message : 'unknown error';
  return message.replace(ANGLE_GROUP, '<…>').replace(ADDRESS_LIKE, '[adresse]');
}
