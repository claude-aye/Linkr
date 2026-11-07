import { Locale } from './types';

/**
 * Render-time cleaning of user-written text that ends up in an email.
 *
 * Why this exists: no email address is ever confirmed (`email_verified_at_utc`
 * is never written), so anyone can open an account with somebody else's
 * address and pick the first name that account greets. Whatever text a user
 * controls must therefore be treated as text a stranger controls. These
 * helpers run in the template, at render time, so a rule can change without
 * touching the jobs already queued.
 */

/** Longest first name rendered in a greeting. */
export const FIRST_NAME_MAX_CHARS = 30;

/** Longest request title rendered, ellipsis included. */
export const TITLE_MAX_CHARS = 60;

/** Control, format (zero-width, bidi override…) and line/paragraph separators. */
const CONTROL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** `domaine.ext` — a dot between word characters ending in a 2+ letter suffix. */
const DOMAIN_LIKE = /[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u;

/** Code-point-safe cut: never splits a surrogate pair. */
const cut = (value: string, max: number): string => {
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join('').trimEnd();
};

/**
 * A token is dropped when it looks like a link or an address: it carries an
 * `@` or `://`, starts with `www` or `http(s)`, or reads `domaine.ext`.
 */
const looksLikeLinkOrAddress = (token: string): boolean =>
  token.includes('@') ||
  token.includes('://') ||
  /^(?:www|https?)(?![\p{L}\p{N}])/iu.test(token) ||
  DOMAIN_LIKE.test(token);

/**
 * Returns a first name safe to print in a greeting, or `''` when nothing
 * usable is left (the caller then greets without a name — see `greet`).
 */
export function cleanFirstName(raw: unknown): string {
  if (typeof raw !== 'string') return '';

  const kept = raw
    .replace(CONTROL_CHARS, ' ')
    .split(/\s+/)
    .filter((token) => token !== '' && !looksLikeLinkOrAddress(token))
    .join(' ');

  return cut(kept, FIRST_NAME_MAX_CHARS);
}

/**
 * The greeting line. Without a usable name it is the neutral "Bonjour," /
 * "Hello," — never "Bonjour ,".
 */
export function greet(locale: Locale, firstName: unknown): string {
  const name = cleanFirstName(firstName);
  const hello = locale === 'fr-CA' ? 'Bonjour' : 'Hello';
  return name ? `${hello} ${name},` : `${hello},`;
}

/**
 * A request title in an email to the CLIENT who wrote it: control characters
 * dropped, whitespace collapsed, at most TITLE_MAX_CHARS characters with the
 * ellipsis counted. Escaping stays with the template (`escapeHtml`).
 */
export function clipTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const clean = raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean);
  if (chars.length <= TITLE_MAX_CHARS) return clean;
  return `${chars.slice(0, TITLE_MAX_CHARS - 1).join('').trimEnd()}…`;
}
