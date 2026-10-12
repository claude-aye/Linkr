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
 * Same background as the pages (`bg-zinc-50`) so the footer reads as the end of
 * the page, not as a separate band.
 */
export function LegalFooter({ locale = 'fr' }: { locale?: LegalLocale }) {
  const labels = LABELS[locale];
  const links = LEGAL_LINKS[locale];

  return (
    <footer
      lang={locale === 'en' ? 'en-CA' : 'fr-CA'}
      className="border-t border-zinc-200 bg-zinc-50 px-6 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <nav aria-label={labels.nav}>
        <ul className="-mx-2 flex flex-wrap items-center gap-x-2 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            <Link
              href={LEGAL_DOCUMENTS[links.privacy].path}
              className="inline-flex min-h-11 items-center px-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
            >
              {labels.privacy}
            </Link>
          </li>
          <li>
            <Link
              href={LEGAL_DOCUMENTS[links.terms].path}
              className="inline-flex min-h-11 items-center px-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
            >
              {labels.terms}
            </Link>
          </li>
          <li>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="inline-flex min-h-11 items-center px-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
            >
              {labels.contact} {SUPPORT_EMAIL}
            </a>
          </li>
        </ul>
      </nav>
    </footer>
  );
}
