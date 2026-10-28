import Link from 'next/link';

import { SUPPORT_EMAIL } from '@/lib/constants';
import { LEGAL_DOCUMENTS, LEGAL_LINKS, type LegalLocale } from '@/lib/legal/legal-pages';

const LABELS: Readonly<
  Record<LegalLocale, { nav: string; privacy: string; terms: string; contact: string }>
> = {
  fr: {
    nav: 'Liens légaux',
    privacy: 'Confidentialité',
    terms: "Conditions d'utilisation",
    // French puts a space before the colon; English does not.
    contact: 'Nous joindre :',
  },
  en: {
    nav: 'Legal links',
    privacy: 'Privacy',
    terms: 'Terms of Use',
    contact: 'Contact us:',
  },
};

/**
 * Site-wide footer: the two legal texts and the support address.
 *
 * Server Component, no data fetch — rendered by the `(auth)` and `(app)`
 * layouts and by each legal page. It is the first place the legal links appear
 * on the site, so it shows on every screen, signed in or not.
 *
 * ⚠️ `min-h-11` ON EVERY LINK — the 44px tap target, same convention as the
 * nav (G-1). The `-mx-2` on the list cancels the `px-2` of the first link so the
 * labels line up with the `p-6` of the page `<main>` above.
 *
 * Tokens of the visual foundation (R3): same ground as the body (`bg-bg`) and the
 * shell's hairline (`border-edge`), so the footer reads as the end of the page,
 * not as a separate band. No palette class and no dark variant (CLAUDE.md §13.1 nº 20).
 */
export function LegalFooter({ locale = 'fr' }: { locale?: LegalLocale }) {
  const labels = LABELS[locale];
  const links = LEGAL_LINKS[locale];

  return (
    <footer
      lang={locale === 'en' ? 'en-CA' : 'fr-CA'}
      className="border-t border-edge bg-bg px-6 py-2">
      <nav aria-label={labels.nav}>
        <ul className="-mx-2 flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
          <li>
            <Link
              href={LEGAL_DOCUMENTS[links.privacy].path}
              className="inline-flex min-h-11 items-center rounded-lg px-2 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {labels.privacy}
            </Link>
          </li>
          <li>
            <Link
              href={LEGAL_DOCUMENTS[links.terms].path}
              className="inline-flex min-h-11 items-center rounded-lg px-2 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {labels.terms}
            </Link>
          </li>
          <li>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="inline-flex min-h-11 items-center rounded-lg px-2 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {labels.contact} {SUPPORT_EMAIL}
            </a>
          </li>
        </ul>
      </nav>
    </footer>
  );
}
