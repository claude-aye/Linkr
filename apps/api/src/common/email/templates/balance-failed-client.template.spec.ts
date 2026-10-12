import { balanceFailedClientEmail } from './balance-failed-client.template';
import { Locale } from './types';

describe('balanceFailedClientEmail', () => {
  const vars = {
    firstName: 'Camille',
    requestTitle: 'Coloration',
    paymentMethodsUrl: 'https://linkr.test/account/payment-methods',
  };
  const locales: Locale[] = ['fr-CA', 'en-CA'];

  it.each(locales)('renders a subject and BOTH bodies in %s', (locale) => {
    const rendered = balanceFailedClientEmail(vars, locale);
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.html).toContain('<html');
    expect(rendered.text.length).toBeGreaterThan(0);
    expect(rendered.text).not.toContain('<');
  });

  it.each(locales)('names the request and links to the payment page in both bodies (%s)', (locale) => {
    const rendered = balanceFailedClientEmail(vars, locale);
    for (const body of [rendered.html, rendered.text]) {
      expect(body).toContain('Camille');
      expect(body).toContain('Coloration');
      expect(body).toContain(vars.paymentMethodsUrl);
    }
    // The button AND the bare-URL fallback.
    expect(rendered.html.split(vars.paymentMethodsUrl).length - 1).toBe(2);
  });

  it('says what to do with the button the page actually shows', () => {
    expect(balanceFailedClientEmail(vars, 'fr-CA').text).toContain('Confirmer le paiement');
    expect(balanceFailedClientEmail(vars, 'en-CA').text).toContain('Confirmer le paiement');
  });

  it('vouvoie, and carries no amount and no Stripe reason', () => {
    const fr = balanceFailedClientEmail(vars, 'fr-CA').text;
    expect(fr).toContain('votre');
    expect(fr).not.toMatch(/\btu\b|\bton\b|\bta\b|\btes\b/);
    expect(fr).not.toMatch(/\$|\d+[,.]\d{2}/);
    expect(fr).not.toContain('authentication');
  });

  it('defaults to fr-CA and renders different copy per locale', () => {
    expect(balanceFailedClientEmail(vars)).toEqual(balanceFailedClientEmail(vars, 'fr-CA'));
    expect(balanceFailedClientEmail(vars, 'fr-CA').subject).not.toEqual(
      balanceFailedClientEmail(vars, 'en-CA').subject,
    );
  });

  it('escapes the user-written title in the HTML body, and keeps it verbatim in the text body', () => {
    const hostile = { ...vars, requestTitle: '<img src=x onerror=alert(1)>' };
    const rendered = balanceFailedClientEmail(hostile, 'fr-CA');
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain('&lt;img');
    expect(rendered.text).toContain(hostile.requestTitle);
  });
});
