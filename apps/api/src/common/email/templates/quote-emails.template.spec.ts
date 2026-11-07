import { quoteAcceptedEmail } from './quote-accepted.template';
import { quoteNotSelectedEmail } from './quote-not-selected.template';
import { quoteReceivedEmail } from './quote-received.template';
import { Locale, RenderedEmail } from './types';

/**
 * The call-for-tenders trio (PR 5). Each template, in each locale: a subject,
 * BOTH bodies, the hostile title escaped in the HTML and verbatim in the text,
 * and the absolute link exactly as the caller built it — never rewritten.
 *
 * Plus the one negative the three share: nothing about money, nothing about a
 * date. Those templates are thin by design (see their headers).
 */

const HOSTILE_TITLE = `<img src=x onerror="alert('x')"> & Co`;
const ESCAPED_TITLE = '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; Co';
const LOCALES: Locale[] = ['fr-CA', 'en-CA'];

type Case = {
  name: string;
  /** True when the email is addressed to the client who wrote the title. */
  rendersTitle: boolean;
  url: string;
  render: (locale: Locale) => RenderedEmail;
  /** A phrase each locale must carry, proving the copy is the right email. */
  expected: Record<Locale, { subject: string; intro: string }>;
};

const QUOTES_URL = 'https://linkr.test/requests/11111111-1111-4111-8111-111111111111/devis';
const JOBS_URL = 'https://linkr.test/dashboard?onglet=jobs';
const TENDERS_URL = 'https://linkr.test/dashboard?onglet=appels-offres';

const CASES: Case[] = [
  {
    name: 'quote-received',
    rendersTitle: true,
    url: QUOTES_URL,
    render: (locale) =>
      quoteReceivedEmail(
        { firstName: 'Alice', requestTitle: HOSTILE_TITLE, quotesUrl: QUOTES_URL },
        locale,
      ),
    expected: {
      'fr-CA': {
        subject: 'Linkr — vous avez reçu un devis',
        intro: 'Vous avez reçu un devis pour « ',
      },
      'en-CA': { subject: 'Linkr — you received a quote', intro: 'You received a quote for "' },
    },
  },
  {
    name: 'quote-accepted',
    rendersTitle: false,
    url: JOBS_URL,
    render: (locale) =>
      quoteAcceptedEmail(
        { firstName: 'Dana', dashboardUrl: JOBS_URL },
        locale,
      ),
    expected: {
      'fr-CA': {
        subject: 'Linkr — votre devis a été retenu',
        intro: 'Votre devis a été retenu pour une demande de service.',
      },
      'en-CA': { subject: 'Linkr — your quote was selected', intro: 'Your quote was selected for a service request.' },
    },
  },
  {
    name: 'quote-not-selected',
    rendersTitle: false,
    url: TENDERS_URL,
    render: (locale) =>
      quoteNotSelectedEmail(
        { firstName: 'Bob', dashboardUrl: TENDERS_URL },
        locale,
      ),
    expected: {
      'fr-CA': {
        subject: 'Linkr — une autre offre a été retenue',
        intro: 'Le client a retenu une autre offre pour une demande de service.',
      },
      'en-CA': {
        subject: 'Linkr — another offer was selected',
        intro: 'The client selected another offer for a service request.',
      },
    },
  },
];

describe.each(CASES)('$name email', (c) => {
  it.each(LOCALES)('renders its own subject and both bodies in %s', (locale) => {
    const rendered = c.render(locale);

    expect(rendered.subject).toBe(c.expected[locale].subject);
    expect(rendered.html).toContain(`<html lang="${locale}">`);
    expect(rendered.text).toContain(c.expected[locale].intro);
    // The text part is not markup: no tag may leak into it.
    expect(rendered.text).not.toMatch(/<(p|a|h1|html|body)\b/);
  });

  it.each(LOCALES)('handles a hostile title (%s)', (locale) => {
    const rendered = c.render(locale);

    if (!c.rendersTitle) {
      // Provider-bound: the title is not rendered at all.
      expect(rendered.html).not.toContain('img');
      expect(rendered.text).not.toContain('img');
      return;
    }

    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain(ESCAPED_TITLE);
    expect(rendered.text).toContain(HOSTILE_TITLE);
    // The fixed subject never carries user text.
    expect(rendered.subject).not.toContain('img');
  });

  it.each(LOCALES)('carries the absolute link exactly, in both bodies (%s)', (locale) => {
    const rendered = c.render(locale);

    expect(rendered.text).toContain(c.url);
    // `&` does not occur in these URLs, so the escaped form equals the raw one:
    // the href and the fallback line carry it byte for byte.
    expect(rendered.html).toContain(`href="${c.url}"`);
    expect(rendered.html.split(c.url).length - 1).toBe(2);
  });

  it.each(LOCALES)('says nothing about money or dates (%s)', (locale) => {
    const { html, text, subject } = c.render(locale);
    for (const body of [html, text, subject]) {
      expect(body).not.toMatch(/\$|CAD|acompte|deposit|montant|amount|\d{4}-\d{2}-\d{2}/i);
    }
  });

  it('defaults to fr-CA', () => {
    // Rendered through the same builder with no locale argument.
    expect(c.render(undefined as unknown as Locale)).toEqual(c.render('fr-CA'));
  });
});
