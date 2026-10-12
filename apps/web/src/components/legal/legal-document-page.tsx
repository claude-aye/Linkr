import Link from 'next/link';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { LegalFooter } from '@/components/legal/legal-footer';
import { loadLegalDocument } from '@/lib/legal/load-legal-document';
import {
  LEGAL_DOCUMENTS,
  formatLastUpdated,
  type LegalDocumentKey,
} from '@/lib/legal/legal-pages';

const ALTERNATE_LABEL = {
  fr: 'Read in English',
  en: 'Lire en français',
} as const;

/** Drops react-markdown's `node` prop so it never reaches the DOM. */
function stripNode<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const { node, ...rest } = props;
  void node;
  return rest;
}

/**
 * Styling for the Markdown, element by element.
 *
 * No `@tailwindcss/typography`: a dependency for four static pages would be a
 * second styling system to keep in step with the rest of the app.
 *
 * ⚠️ TABLES SCROLL INSIDE THEIR OWN BOX. The privacy policy carries three
 * three-column tables; at 320px a wide cell would otherwise push the whole
 * page sideways. The wrapper scrolls, the page does not. Cells tighten their
 * padding below `sm:` and hyphenate (`lang` is set on `<main>`), so most
 * tables fit a phone without scrolling at all.
 *
 * Internal links (`/confidentialite`, `/privacy`) go through `next/link`;
 * `mailto:` and external links stay plain anchors.
 */
const MARKDOWN_COMPONENTS: Components = {
  h2: (props) => (
    <h2
      className="mt-10 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
      {...stripNode(props)}
    />
  ),
  h3: (props) => (
    <h3
      className="mt-6 text-base font-semibold text-zinc-900 dark:text-zinc-50"
      {...stripNode(props)}
    />
  ),
  p: (props) => <p className="mt-4 leading-7" {...stripNode(props)} />,
  ul: (props) => (
    <ul className="mt-4 list-disc space-y-2 pl-6 leading-7" {...stripNode(props)} />
  ),
  ol: (props) => (
    <ol className="mt-4 list-decimal space-y-2 pl-6 leading-7" {...stripNode(props)} />
  ),
  strong: (props) => (
    <strong className="font-semibold text-zinc-900 dark:text-zinc-50" {...stripNode(props)} />
  ),
  code: (props) => (
    <code
      className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.9em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
      {...stripNode(props)}
    />
  ),
  table: (props) => (
    <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full border-collapse text-left text-sm" {...stripNode(props)} />
    </div>
  ),
  thead: (props) => (
    <thead className="bg-zinc-100 dark:bg-zinc-900" {...stripNode(props)} />
  ),
  th: (props) => (
    <th
      className="border-b border-zinc-200 px-2 py-2 align-top font-semibold hyphens-auto sm:px-3 text-zinc-900 dark:border-zinc-800 dark:text-zinc-50"
      {...stripNode(props)}
    />
  ),
  td: (props) => (
    <td
      className="border-b border-zinc-200 px-2 py-2 align-top hyphens-auto dark:border-zinc-800 sm:px-3"
      {...stripNode(props)}
    />
  ),
  a: (props) => {
    const { href, children, ...rest } = stripNode(props);
    const className =
      'font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-50 dark:hover:text-zinc-300';
    if (href?.startsWith('/')) {
      return (
        <Link href={href} className={className}>
          {children}
        </Link>
      );
    }
    const external = href?.startsWith('http');
    return (
      <a
        href={href}
        className={className}
        {...(external ? { rel: 'noopener noreferrer' } : {})}
        {...rest}
      >
        {children}
      </a>
    );
  },
};

/**
 * One legal page: title, last-updated line, link to the twin in the other
 * language, the text, and the footer in the page's language.
 *
 * ⚠️ `lang` IS SET ON `<main>`, NOT ON `<html>`. The root layout pins
 * `<html lang="fr-CA">` for the whole app, and there is no i18n system to
 * change it per route. The English pages declare `lang="en-CA"` on their own
 * content, which is what screen readers and search engines read for it —
 * without touching the root layout.
 */
export async function LegalDocumentPage({ docKey }: { docKey: LegalDocumentKey }) {
  const doc = LEGAL_DOCUMENTS[docKey];
  const alternate = LEGAL_DOCUMENTS[doc.alternate];
  const source = await loadLegalDocument(doc);

  return (
    <>
      <main
        lang={doc.lang}
        className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950"
      >
        <article className="w-full max-w-3xl text-zinc-700 dark:text-zinc-300">
          <header className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {doc.title}
            </h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {formatLastUpdated(doc.locale)}
            </p>
            <p className="mt-1 text-sm">
              <Link
                href={alternate.path}
                hrefLang={alternate.lang}
                lang={alternate.lang}
                className="-mx-2 inline-flex min-h-11 items-center px-2 font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-50 dark:hover:text-zinc-300"
              >
                {ALTERNATE_LABEL[doc.locale]}
              </Link>
            </p>
          </header>
          <div className="pb-6">
            <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {source}
            </Markdown>
          </div>
        </article>
      </main>
      <LegalFooter locale={doc.locale} />
    </>
  );
}
