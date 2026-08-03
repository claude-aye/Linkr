import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  baseCookieOptions,
} from '@/lib/auth/cookies';
import type { AuthResponse } from '@/lib/auth/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

/**
 * TODO — Québec-only launch. These become user-selected when Linkr opens
 * beyond QC. The data model is already international; only this default is not.
 *
 * The three fields are REQUIRED by `SignupDto` but are NOT asked of the user:
 * they are pinned here, server-side, in ONE named constant — never scattered
 * across the client component. One place to change the day Linkr crosses a
 * border. `languagePreference` is deliberately absent: it is optional on the DTO
 * and the API already defaults it to `fr-CA`.
 */
const QUEBEC_LOCALE_DEFAULTS = {
  countryCode: 'CA',
  subdivisionCode: 'CA-QC',
  preferredCurrency: 'CAD',
} as const;

interface SignupRequestBody {
  email?: unknown;
  password?: unknown;
  firstName?: unknown;
  lastName?: unknown;
}

/**
 * BFF signup proxy. Twin of `api/auth/login` — same cookie names, same options,
 * same `{ user }` response shape. Product decision: signing up LOGS YOU IN, so
 * this handler poses the very same pair of httpOnly cookies rather than bouncing
 * a fresh account through the sign-in screen. Two auth paths that posed cookies
 * differently would be a bug waiting to happen, so the cookie block below is a
 * byte-for-byte copy of login's.
 *
 * `POST /auth/signup` returns `AuthResponseDto` — `{ accessToken, refreshToken,
 * user }`, IDENTICAL to `POST /auth/login` (verified in the API source:
 * `auth.controller.ts` → `authService.signup()` returns the same DTO as
 * `login()`). It answers 201 (no `@HttpCode`, unlike login's explicit 200); the
 * `.ok` test below covers both, and this handler still answers 200 so its shape
 * matches login's exactly.
 */
export async function POST(request: Request) {
  let body: SignupRequestBody;
  try {
    body = (await request.json()) as SignupRequestBody;
  } catch {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const { email, password, firstName, lastName } = body;
  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    typeof firstName !== 'string' ||
    typeof lastName !== 'string'
  ) {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  // Server-to-server. Same documented `fetch` as login: the API's OpenAPI ships
  // `POST /auth/signup` with an empty Swagger DTO, so the typed api-client cannot
  // carry this body. Signup is `@Public()` — no token here.
  //
  // The payload is assembled FIELD BY FIELD, never spread from the incoming body:
  // the API runs `ValidationPipe({ forbidNonWhitelisted: true })`, so any extra
  // key a caller slipped in would 400 the whole signup — and `phone` /
  // `displayName` / `languagePreference` must not be settable from here.
  let apiResponse: Response;
  try {
    apiResponse = await fetch(`${API_BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        firstName,
        lastName,
        ...QUEBEC_LOCALE_DEFAULTS,
      }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }

  if (!apiResponse.ok) {
    if (apiResponse.status >= 500) {
      return NextResponse.json(
        { message: 'Service indisponible. Réessaie plus tard.' },
        { status: 502 },
      );
    }
    // 409 is RELAYED AS-IS — the one place this handler cannot collapse errors
    // like login does. `AuthService.signup` throws `ConflictException('Email
    // already registered')` on a duplicate, and that is the single case the page
    // must tell the user how to fix (« this email already has an account → sign
    // in »). Everything else non-5xx (400 validation) stays generic. No cookie is
    // set on any of these paths.
    if (apiResponse.status === 409) {
      return NextResponse.json({ message: 'Courriel déjà utilisé.' }, { status: 409 });
    }
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const auth = (await apiResponse.json()) as AuthResponse;

  const store = await cookies();
  store.set(ACCESS_COOKIE, auth.accessToken, {
    ...baseCookieOptions,
    maxAge: ACCESS_MAX_AGE,
  });
  store.set(REFRESH_COOKIE, auth.refreshToken, {
    ...baseCookieOptions,
    maxAge: REFRESH_MAX_AGE,
  });

  // Only the user is returned to the browser — never the tokens.
  return NextResponse.json({ user: auth.user });
}
