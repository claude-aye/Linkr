/**
 * The four legal pages — one registry, read by the proxy, the pages and the
 * footer.
 *
 * ⚠️ NO IMPORTS, BY CONTRACT. This module is loaded as-is by `node --test`
 * (`web-tests.yml` installs nothing), and `proxy.ts` reads `LEGAL_PATHS` from
 * it. An import here would break the test job loudly — keep it that way.
 *
 * ⚠️ THE PATHS ARE QUASI-IMMUTABLE. The signup consent (PR L2) records which
 * version of the terms a person accepted, and these URLs will end up in
 * emails, in the trial announcement and in bookmarks. Renaming one breaks
 * links already handed out. If one must move, the old path keeps resolving.
 */

/**
 * Date of the texts currently published, as a civil day (`YYYY-MM-DD`).
 *
 * The single source of truth for « Dernière mise à jour » on every page, and
 * the value PR L2 will store in `users.terms_version`. Bump it in the same
 * commit as any substantive change to the Markdown files under
 * `content/legal/` — a change that leaves it untouched means nobody can tell
 * who accepted which text.
 */
export const LEGAL_VERSION = '2026-10-11';

export type LegalLocale = 'fr' | 'en';

export type LegalDocumentKey =
  | 'privacy-fr'
  | 'terms-fr'
  | 'privacy-en'
  | 'terms-en';

export type LegalDocument = {
  readonly key: LegalDocumentKey;
  readonly path: string;
  readonly locale: LegalLocale;
  /** BCP 47 tag set on the page's `<main lang>`. */
  readonly lang: 'fr-CA' | 'en-CA';
  readonly title: string;
  /** Markdown file, relative to `content/legal/`. */
  readonly file: string;
  /** The same text in the other language. */
  readonly alternate: LegalDocumentKey;
};

export const LEGAL_DOCUMENTS: Readonly<Record<LegalDocumentKey, LegalDocument>> = {
  'privacy-fr': {
    key: 'privacy-fr',
    path: '/confidentialite',
    locale: 'fr',
    lang: 'fr-CA',
    title: 'Politique de confidentialité',
    file: 'fr/confidentialite.md',
    alternate: 'privacy-en',
  },
  'terms-fr': {
    key: 'terms-fr',
    path: '/conditions',
    locale: 'fr',
    lang: 'fr-CA',
    title: "Conditions d'utilisation",
    file: 'fr/conditions.md',
    alternate: 'terms-en',
  },
  'privacy-en': {
    key: 'privacy-en',
    path: '/privacy',
    locale: 'en',
    lang: 'en-CA',
    title: 'Privacy Policy',
    file: 'en/privacy.md',
    alternate: 'privacy-fr',
  },
  'terms-en': {
    key: 'terms-en',
    path: '/terms',
    locale: 'en',
    lang: 'en-CA',
    title: 'Terms of Use',
    file: 'en/terms.md',
    alternate: 'terms-fr',
  },
};

/**
 * Paths reachable by everyone, signed in or not.
 *
 * ⚠️ READ BY `proxy.ts` BEFORE ITS PUBLIC-PAGES BRANCH, AND THAT ORDER IS THE
 * POINT. Listed in `PUBLIC_PAGES` instead, these would hit the « signed-in
 * visitor → /dashboard » bounce: a logged-in user clicking « Confidentialité »
 * in the footer would land on the dashboard and never read the policy.
 */
export const LEGAL_PATHS: readonly string[] = Object.values(LEGAL_DOCUMENTS).map(
  (doc) => doc.path,
);

/** Footer and cross-links, per language. */
export const LEGAL_LINKS: Readonly<
  Record<LegalLocale, { privacy: LegalDocumentKey; terms: LegalDocumentKey }>
> = {
  fr: { privacy: 'privacy-fr', terms: 'terms-fr' },
  en: { privacy: 'privacy-en', terms: 'terms-en' },
};

const LAST_UPDATED_LABEL: Readonly<Record<LegalLocale, string>> = {
  fr: 'Dernière mise à jour',
  en: 'Last updated',
};

const DATE_LOCALE: Readonly<Record<LegalLocale, string>> = {
  fr: 'fr-CA',
  en: 'en-CA',
};

/**
 * « Dernière mise à jour : 11 octobre 2026 » / « Last updated: October 11, 2026 ».
 *
 * ⚠️ `timeZone: 'UTC'` IS LOAD-BEARING. `LEGAL_VERSION` is a CIVIL DAY, not an
 * instant: `new Date('2026-10-11')` parses to midnight UTC, and formatting it
 * in America/Toronto would print the PREVIOUS day. Same reason
 * `admin/demand-signals` keeps its own UTC formatter and does not use
 * `lib/dates/format.ts`.
 */
export function formatLastUpdated(
  locale: LegalLocale,
  version: string = LEGAL_VERSION,
): string {
  const date = new Date(`${version}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version) || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid legal version: ${version}`);
  }
  const day = new Intl.DateTimeFormat(DATE_LOCALE[locale], {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(date);
  // French puts a space before the colon; English does not.
  const separator = locale === 'fr' ? ' : ' : ': ';
  return `${LAST_UPDATED_LABEL[locale]}${separator}${day}`;
}
