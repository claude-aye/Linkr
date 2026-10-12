/**
 * Assembly of the body the signup BFF sends to `POST /auth/signup`.
 *
 * ⚠️ NO IMPORTS, BY CONTRACT — loaded as-is by `node --test`. That is why the
 * terms version is a PARAMETER: the route passes `LEGAL_VERSION`, and this
 * module never reaches for it.
 *
 * The body is assembled FIELD BY FIELD, never spread from what the browser
 * sent: the API runs `forbidNonWhitelisted`, so one stray key would 400 the
 * whole signup, and `phone` / `displayName` / `languagePreference` must not be
 * settable from the browser.
 *
 * Consent (PR L2): the browser sends only `acceptTerms: true`. The VERSION is
 * added here, server-side — the person never types it and cannot choose it —
 * and the API checks it against its own constant. The DATE is set by the API.
 *
 * Returns `null` when the incoming body is not usable; the route answers 400.
 * `acceptTerms` must be the boolean `true` — anything else is not consent, and
 * relaying it would only buy a 400 from the API one round-trip later.
 */

export type SignupLocaleDefaults = {
  readonly countryCode: string;
  readonly subdivisionCode: string;
  readonly preferredCurrency: string;
};

export type SignupApiBody = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  countryCode: string;
  subdivisionCode: string;
  preferredCurrency: string;
  acceptTerms: true;
  termsVersion: string;
};

export function assembleSignupBody(
  incoming: unknown,
  localeDefaults: SignupLocaleDefaults,
  termsVersion: string,
): SignupApiBody | null {
  if (typeof incoming !== 'object' || incoming === null) return null;
  const body = incoming as Record<string, unknown>;
  const { email, password, firstName, lastName, acceptTerms } = body;

  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    typeof firstName !== 'string' ||
    typeof lastName !== 'string' ||
    acceptTerms !== true
  ) {
    return null;
  }

  return {
    email,
    password,
    firstName,
    lastName,
    countryCode: localeDefaults.countryCode,
    subdivisionCode: localeDefaults.subdivisionCode,
    preferredCurrency: localeDefaults.preferredCurrency,
    acceptTerms: true,
    termsVersion,
  };
}
