import { escapeHtml } from './escape';
import { probeEmail } from './probe.template';
import {
  EMAIL_TEMPLATES,
  EmailTemplateName,
  EmailTemplateVars,
  isEmailTemplateName,
} from './index';
import { Locale, RenderedEmail } from './types';

describe('probeEmail', () => {
  const vars = { label: 'smoke-1', enqueuedAtUtc: '2026-08-22T14:03:00.000Z' };
  const locales: Locale[] = ['fr-CA', 'en-CA'];

  it.each(locales)('renders a subject and BOTH bodies in %s', (locale) => {
    const rendered = probeEmail(vars, locale);

    // A-1.7: an email without a text part lands in spam. Neither body is
    // optional, and neither may come back empty.
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.html.length).toBeGreaterThan(0);
    expect(rendered.text.length).toBeGreaterThan(0);
    expect(rendered.html).toContain('<html');
    expect(rendered.text).not.toContain('<');
  });

  it.each(locales)('interpolates its vars into both bodies in %s', (locale) => {
    const rendered = probeEmail(vars, locale);

    for (const body of [rendered.html, rendered.text]) {
      expect(body).toContain(vars.label);
      expect(body).toContain(vars.enqueuedAtUtc);
    }
  });

  it('defaults to fr-CA', () => {
    expect(probeEmail(vars)).toEqual(probeEmail(vars, 'fr-CA'));
  });

  it('renders different copy per locale', () => {
    // Guards against a template that takes the locale and ignores it — the
    // failure mode a dictionary is supposed to make impossible.
    expect(probeEmail(vars, 'fr-CA').subject).not.toEqual(
      probeEmail(vars, 'en-CA').subject,
    );
  });

  it('escapes vars before they reach the HTML body', () => {
    const hostile = {
      label: '<script>alert(1)</script>',
      enqueuedAtUtc: '2026-08-22T14:03:00.000Z',
    };
    const rendered = probeEmail(hostile, 'fr-CA');

    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    // The text part is not markup, so it carries the value verbatim.
    expect(rendered.text).toContain(hostile.label);
  });
});

describe('escapeHtml', () => {
  it('escapes every character that can break out of markup', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Réinitialisation du mot de passe')).toBe(
      'Réinitialisation du mot de passe',
    );
  });
});

/**
 * One set of vars per registered template.
 *
 * ⚠️ THIS MAP REPLACED A SINGLE SHARED `vars` OBJECT, and it had to. The loop
 * below renders EVERY entry of the registry; with more than one template,
 * `Parameters<(typeof EMAIL_TEMPLATES)[name]>` collapses to an INTERSECTION of
 * every template's vars, so one shared bag stops compiling the moment a second
 * template exists (measured in A-2: TS2345, `missing the following properties
 * from type 'PasswordResetEmailVars'`). Typing it `Record<EmailTemplateName, …>`
 * keeps the loop's original intent and sharpens it: a new template with no
 * fixture here is now a BUILD error, not a silently unexercised template.
 */
const TEMPLATE_FIXTURES: {
  [TName in EmailTemplateName]: EmailTemplateVars<TName>;
} = {
  probe: { label: 'registry', enqueuedAtUtc: '2026-08-22T14:03:00.000Z' },
  'password-reset': {
    firstName: 'Camille',
    resetUrl: 'https://linkr.test/reset-password?token=abc',
    expiresInMinutes: 60,
  },
};

describe('template registry', () => {

  it('recognises a registered name', () => {
    expect(isEmailTemplateName('probe')).toBe(true);
  });

  it('rejects an unregistered name', () => {
    // This is what stands between a bad payload and a worker retrying three
    // times over a name that will never exist.
    expect(isEmailTemplateName('nope')).toBe(false);
  });

  it('rejects inherited Object properties', () => {
    // `'toString' in EMAIL_TEMPLATES` would be true; hasOwnProperty is why the
    // guard does not hand Object.prototype.toString to the renderer.
    expect(isEmailTemplateName('toString')).toBe(false);
    expect(isEmailTemplateName('constructor')).toBe(false);
  });

  it('renders every registered template in every locale', () => {
    // Adding a template without copy for a locale fails here, not in someone's
    // inbox — and adding one without a fixture above fails at compile time.
    for (const name of Object.keys(EMAIL_TEMPLATES) as EmailTemplateName[]) {
      for (const locale of ['fr-CA', 'en-CA'] as Locale[]) {
        const render = EMAIL_TEMPLATES[name] as (
          vars: EmailTemplateVars<typeof name>,
          locale: Locale,
        ) => RenderedEmail;
        const rendered = render(TEMPLATE_FIXTURES[name], locale);
        expect(rendered.subject).toBeTruthy();
        expect(rendered.html).toBeTruthy();
        expect(rendered.text).toBeTruthy();
      }
    }
  });
});
