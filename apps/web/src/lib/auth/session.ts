import 'server-only';

import { cookies } from 'next/headers';
import { createApiClient } from '@linkr/api-client';

import { ACCESS_COOKIE } from './cookies';
import type { AuthUser } from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

/**
 * An `@linkr/api-client` instance authenticated by the httpOnly access cookie,
 * READ SERVER-SIDE. This is where the `getToken` hook — present but dormant since
 * 3.11a — is finally wired: the Bearer token is sourced exclusively from the
 * cookie store, never from browser JS.
 */
export async function getServerApiClient() {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;
  return createApiClient({ baseUrl: API_BASE_URL, getToken: () => token });
}

/**
 * Resolve the current user via `GET /auth/me` using the access cookie.
 *
 * Returns `null` when there is no token, or when the API rejects it (e.g. an
 * expired access token — in 3.11b-1 there is no auto-refresh yet, so a 15-min-old
 * session resolves to `null` and the caller redirects to `/login`).
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  if (!store.get(ACCESS_COOKIE)?.value) return null;

  const client = await getServerApiClient();
  try {
    // `/auth/me` exists in the OpenAPI but ships no response schema, so the
    // generated `data` type is `never`; cast through the local AuthUser mirror.
    // openapi-fetch still parses the JSON body at runtime regardless of the type.
    const { data, error, response } = await client.GET('/auth/me');
    if (error || !response.ok) return null;
    return (data as unknown as AuthUser | undefined) ?? null;
  } catch {
    // API unreachable / network failure — treat as unauthenticated.
    return null;
  }
}
