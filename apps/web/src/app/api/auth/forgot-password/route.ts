import { NextResponse } from 'next/server';

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
 * the API worked to remove. It collapses EVERY upstream outcome to 202 with an
 * empty body — including 5xx and a dead API, which fall through to 202 as well.
 *
 * That is a deliberate deviation from the transparent relay used everywhere else
 * in this codebase, and it costs something real: a user whose mail genuinely
 * failed to send is told the same thing as one whose mail is on its way. The
 * alternative is worse — a 502 that only ever appears on the path that does work
 * would be exactly the enumeration signal the 202 exists to deny. The failure is
 * logged server-side instead, where it can be diagnosed without being broadcast.
 *
 * The 429 from the route's IP rate limit is also collapsed, for the same reason:
 * it is about the caller's IP, never about whether the address exists, and the
 * page has nothing useful to do with it that it cannot do with the 202.
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });

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
