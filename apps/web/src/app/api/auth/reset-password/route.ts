import { NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

interface ResetPasswordRequestBody {
  token?: unknown;
  password?: unknown;
}

/**
 * BFF relay for `POST /auth/reset-password`.
 *
 * A transparent relay, unlike its sibling above: here the caller SHOULD learn
 * what happened, because every outcome is about the link they are holding and
 * not about whether some account exists. The API already collapses unknown,
 * expired, consumed and rotated into one 400 with one message, so relaying it
 * verbatim leaks nothing the API did not decide to say.
 *
 * ⚠️ NO COOKIE IS SET HERE, AND THAT IS THE DECISION (A-2.21). Its two siblings
 * in this folder — login and signup — both pose the httpOnly pair. This one
 * does not: a successful reset sends the user to the sign-in page. They have
 * just proven control of a mailbox, not of the new password, and typing it once
 * deliberately is what catches a typo before it locks them out.
 *
 * ⚠️ THE TOKEN IS NEVER LOGGED, on any branch. It is a live credential until the
 * moment it is consumed.
 */
export async function POST(request: Request) {
  let body: ResetPasswordRequestBody;
  try {
    body = (await request.json()) as ResetPasswordRequestBody;
  } catch {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const { token, password } = body;
  if (typeof token !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  let apiResponse: Response;
  try {
    // Field by field, never spread — `forbidNonWhitelisted` upstream.
    apiResponse = await fetch(`${API_BASE_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }

  // 204 carries no body, and must not be given one.
  if (apiResponse.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const payload: unknown = await apiResponse.json().catch(() => null);
  return NextResponse.json(payload ?? null, { status: apiResponse.status });
}
