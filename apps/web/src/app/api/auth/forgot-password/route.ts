import { NextResponse } from 'next/server';

import { withClientIp } from '@/lib/http/client-ip';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

interface ForgotPasswordRequestBody {
  email?: unknown;
}

/**
 * BFF relay for `POST /auth/forgot-password`.
 *
 * ⚠️ THIS HANDLER HAS ONE JOB THE OTHER RELAYS DO NOT: KEEPING THE ANSWER
 * CONSTANT. The API answers 202 for every case on purpose (unknown address,
 * known address, suppressed send), so this relay must not reintroduce a branch
 * the API worked to remove. It collapses every upstream outcome but one to 202
 * with an empty body — including 5xx and a dead API, which fall through to 202
 * as well. (The exception is the IP budget's 429; see the note below.)
 *
 * That is a deliberate deviation from the transparent relay used everywhere else
 * in this codebase, and it costs something real: a user whose mail genuinely
 * failed to send is told the same thing as one whose mail is on its way. The
 * alternative is worse — a 502 that only ever appears on the path that does work
 * would be exactly the enumeration signal the 202 exists to deny. The failure is
 * logged server-side instead, where it can be diagnosed without being broadcast.
 *
 * ⚠️ TWO CAPS GUARD THIS FLOW AND THEY ARE NOT INTERCHANGEABLE — CONFUSING THEM
 * IS AN ENUMERATION LEAK. Chantier B revisits the A-2 note that used to collapse
 * both:
 *
 *   - The IP budget (`AUTH_RATE_LIMITS.FORGOT_PASSWORD`) is raised by a guard
 *     that runs BEFORE the address is looked at at all. It says something about
 *     the caller's connection and is byte-identical whatever they typed, so it
 *     is RELAYED: a user who has to wait deserves to be told to wait rather than
 *     handed the same screen as a success, which is what the collapse did.
 *
 *   - The per-address send cap (five an hour, in `PasswordResetService`)
 *     suppresses the SEND and never the response. It STAYS INVISIBLE — 202,
 *     always. Surfacing it would be exactly the oracle everything else here
 *     avoids, because it can only ever be reached by an address that exists.
 *
 * The rule that follows: the 429, and only the 429, escapes. Every other outcome
 * — 202, a validation error, a 5xx, a dead API — is still collapsed to 202.
 *
 * No token, no cookie, no session: this route is anonymous end to end.
 */
export async function POST(request: Request) {
  let body: ForgotPasswordRequestBody;
  try {
    body = (await request.json()) as ForgotPasswordRequestBody;
  } catch {
    // A malformed body is a client bug, not an account probe — and it cannot
    // distinguish anything, so answering 400 here leaks nothing.
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const { email } = body;
  if (typeof email !== 'string') {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  try {
    // Assembled field by field, never spread: the API runs
    // `forbidNonWhitelisted`, so one stray key would 400 the whole request.
    const apiResponse = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
      method: 'POST',
      // Carries the visitor's address so the IP budget meters a PERSON rather
      // than this server. It matters more here than anywhere: a shared bucket
      // would let one caller spend the whole site's reset allowance, locking
      // everyone else out of their own accounts.
      headers: withClientIp({ 'Content-Type': 'application/json' }, request),
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });

    // The single escape hatch, per the note above. `Retry-After` rides along so
    // the page can say HOW LONG rather than just "later".
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

    if (!apiResponse.ok) {
      // Logged, not surfaced. `console.error` is the only logger available in a
      // route handler; the address is NOT logged — it is the one field here
      // whose disclosure would matter.
      console.error(
        `forgot-password upstream returned ${apiResponse.status}; answering 202 anyway`,
      );
    }
  } catch {
    console.error('forgot-password upstream unreachable; answering 202 anyway');
  }

  return new NextResponse(null, { status: 202 });
}
