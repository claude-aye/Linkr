import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  baseCookieOptions,
} from '@/lib/auth/cookies';
import { withClientIp } from '@/lib/http/client-ip';
import type { AuthResponse } from '@/lib/auth/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

interface LoginRequestBody {
  email?: unknown;
  password?: unknown;
}

/**
 * BFF login proxy. Validates the body, calls the real API server-to-server, and
 * on success poses the two httpOnly cookies — returning ONLY the `user` to the
 * browser. The tokens never cross back to the client.
 */
export async function POST(request: Request) {
  let body: LoginRequestBody;
  try {
    body = (await request.json()) as LoginRequestBody;
  } catch {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const { email, password } = body;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  // Server-to-server. The typed api-client cannot carry this body: the API's
  // OpenAPI declares `POST /auth/login` with `requestBody?: never` (empty Swagger
  // DTO), so we use a documented fetch. Login is `@Public()` — no token here.
  let apiResponse: Response;
  try {
    apiResponse = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      // The visitor's address travels with the call so the API's per-IP budget
      // meters a PERSON, not this server. Without it every visitor shares one
      // bucket and the first heavy caller locks out the rest.
      headers: withClientIp({ 'Content-Type': 'application/json' }, request),
      body: JSON.stringify({ email, password }),
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
    // ⚠️ THE 429 IS THE ONE NON-5xx THIS HANDLER MUST NOT COLLAPSE, AND IT LEAKS
    // NOTHING. It is raised by a guard that runs BEFORE any user lookup, so it
    // is byte-identical for a known and an unknown address: it describes the
    // caller's connection, never an account. Folded into the 401 below it would
    // read as "wrong password" to someone whose password is fine — the same
    // symptom as an outage, and only ever suffered by a legitimate user.
    // `Retry-After` rides along so the page can say HOW LONG rather than
    // "later". Still no cookie on this path.
    if (apiResponse.status === 429) {
      const retryAfter = apiResponse.headers.get('retry-after');
      return NextResponse.json(
        { message: 'Trop de tentatives.' },
        {
          status: 429,
          headers: retryAfter ? { 'Retry-After': retryAfter } : undefined,
        },
      );
    }
    // Generic message — never leak whether the email exists or the credential
    // detail. No cookie is set on this path.
    return NextResponse.json({ message: 'Identifiants invalides.' }, { status: 401 });
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
