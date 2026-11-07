import { balanceFailedClientEmail } from './balance-failed-client.template';
import { depositFailedClientEmail } from './deposit-failed-client.template';
import { depositFailedProviderEmail } from './deposit-failed-provider.template';
import { directBookingEmail } from './direct-booking.template';
import { jobCompletedEmail } from './job-completed.template';
import { passwordResetEmail } from './password-reset.template';
import { quoteAcceptedEmail } from './quote-accepted.template';
import { quoteNotSelectedEmail } from './quote-not-selected.template';
import { quoteReceivedEmail } from './quote-received.template';
import { requestAcceptedEmail } from './request-accepted.template';
import { requestDeclinedEmail } from './request-declined.template';
import { Locale, RenderedEmail } from './types';

/**
 * C1 — no free text from another account in any email.
 *   - provider-bound emails never render the request title;
 *   - client-bound emails clip it to 60 characters and escape it;
 *   - the declined email never renders the provider's reason;
 *   - every greeting goes through the first-name cleaner.
 */

const LOCALES: Locale[] = ['fr-CA', 'en-CA'];
const URL_ = 'https://linkr.test/x';
const LONG_TITLE = 'T'.repeat(200);
const HOSTILE_TITLE = '<script>alert(1)</script> http://evil.example';
const HOSTILE_NAME = 'Eve https://evil.example/pay eve@evil.example';

const PROVIDER_BOUND: Array<[string, (n: string, l: Locale) => RenderedEmail, string, string]> = [
  [
    'direct-booking',
    (n, l) => directBookingEmail({ firstName: n, dashboardUrl: URL_ }, l),
    'pour une demande de service',
    'for a service request',
  ],
  [
    'deposit-failed-provider',
    (n, l) => depositFailedProviderEmail({ firstName: n, dashboardUrl: URL_ }, l),
    'd’une demande de service',
    'for a service request',
  ],
  [
    'quote-accepted',
    (n, l) => quoteAcceptedEmail({ firstName: n, dashboardUrl: URL_ }, l),
    'pour une demande de service',
    'for a service request',
  ],
  [
    'quote-not-selected',
    (n, l) => quoteNotSelectedEmail({ firstName: n, dashboardUrl: URL_ }, l),
    'pour une demande de service',
    'for a service request',
  ],
];

const CLIENT_BOUND: Array<[string, (n: string, t: string, l: Locale) => RenderedEmail]> = [
  ['request-accepted', (n, t, l) => requestAcceptedEmail({ firstName: n, requestTitle: t, requestsUrl: URL_ }, l)],
  [
    'request-declined',
    (n, t, l) => requestDeclinedEmail({ firstName: n, requestTitle: t, requestsUrl: URL_ }, l),
  ],
  [
    'job-completed',
    (n, t, l) =>
      jobCompletedEmail({ firstName: n, requestTitle: t, autoReleaseHours: 72, requestsUrl: URL_ }, l),
  ],
  [
    'deposit-failed-client',
    (n, t, l) => depositFailedClientEmail({ firstName: n, requestTitle: t, paymentMethodsUrl: URL_ }, l),
  ],
  [
    'balance-failed-client',
    (n, t, l) => balanceFailedClientEmail({ firstName: n, requestTitle: t, paymentMethodsUrl: URL_ }, l),
  ],
  ['quote-received', (n, t, l) => quoteReceivedEmail({ firstName: n, requestTitle: t, quotesUrl: URL_ }, l)],
];

describe.each(PROVIDER_BOUND)('%s (provider-bound)', (_name, render, fr, en) => {
  it.each(LOCALES)('renders the fixed phrase and no title (%s)', (locale) => {
    const { html, text } = render('Dana', locale);
    const phrase = locale === 'fr-CA' ? fr : en;
    expect(text).toContain(phrase);
    expect(html).toContain(phrase);
  });

  it.each(LOCALES)('cleans a hostile first name (%s)', (locale) => {
    const { html, text } = render(HOSTILE_NAME, locale);
    for (const body of [html, text]) {
      expect(body).toContain('Eve');
      expect(body).not.toContain('evil');
    }
  });

  it.each(LOCALES)('greets neutrally when the name is empty (%s)', (locale) => {
    const { text } = render('', locale);
    expect(text).toContain(locale === 'fr-CA' ? 'Bonjour,' : 'Hello,');
    expect(text).not.toMatch(/(Bonjour|Hello) ,/);
  });
});

describe.each(CLIENT_BOUND)('%s (client-bound)', (_name, render) => {
  it.each(LOCALES)('clips a 200-character title to 60 characters (%s)', (locale) => {
    const { text, html } = render('Alice', LONG_TITLE, locale);
    expect(text).toContain('T'.repeat(59) + '…');
    expect(text).not.toContain('T'.repeat(60));
    expect(html).not.toContain('T'.repeat(60));
  });

  it.each(LOCALES)('escapes a hostile title in the HTML (%s)', (locale) => {
    const { html } = render('Alice', HOSTILE_TITLE, locale);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it.each(LOCALES)('cleans a hostile first name (%s)', (locale) => {
    const { html, text } = render(HOSTILE_NAME, 'Robinet', locale);
    for (const body of [html, text]) {
      expect(body).toContain('Eve');
      expect(body).not.toContain('evil');
    }
  });

  it.each(LOCALES)('greets neutrally when the name is empty (%s)', (locale) => {
    const { text } = render('', 'Robinet', locale);
    expect(text).toContain(locale === 'fr-CA' ? 'Bonjour,' : 'Hello,');
  });
});

describe('request-declined', () => {
  it.each(LOCALES)('says the provider replied and points to the app (%s)', (locale) => {
    const { text, html } = requestDeclinedEmail(
      { firstName: 'Alice', requestTitle: 'Robinet', requestsUrl: URL_ },
      locale,
    );
    const phrase = locale === 'fr-CA' ? 'a répondu à votre demande' : 'replied to your request';
    expect(text).toContain(phrase);
    expect(html).toContain(phrase);
    expect(text).toContain(URL_);
  });

  it('ignores a `reason` smuggled in through the wire payload', () => {
    // A job queued before this change still carries `reason` in Redis.
    const stale = {
      firstName: 'Alice',
      requestTitle: 'Robinet',
      requestsUrl: URL_,
      reason: 'Appelez-moi au 514-555-0100',
    } as unknown as Parameters<typeof requestDeclinedEmail>[0];
    const { text, html } = requestDeclinedEmail(stale, 'fr-CA');
    expect(text).not.toContain('514');
    expect(html).not.toContain('514');
  });
});

describe('password-reset', () => {
  it.each(LOCALES)('cleans the first name too (%s)', (locale) => {
    const { text } = passwordResetEmail(
      { firstName: HOSTILE_NAME, resetUrl: URL_, expiresInMinutes: 60 },
      locale,
    );
    expect(text).not.toContain('evil');
    expect(text).toContain('Eve');
  });
});

