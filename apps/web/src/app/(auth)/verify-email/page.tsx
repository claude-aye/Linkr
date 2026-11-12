/**
 * Confirm the email address (`/verify-email?token=…`) — L2.
 *
 * Server Component + client card, the `reset-password` pattern. This READS the
 * token and does NOT act on it: only the button's POST consumes it. Mail
 * scanners and link previewers fetch URLs before a human clicks, and a page
 * that consumed on load would burn the token before its owner saw it. Rendering
 * must stay free of side effects. The session lookup below is a plain read.
 */
import { getCurrentUser } from '@/lib/auth/session';

import { VerifyEmailCard } from './verify-email-card';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  // `?token=a&token=b` is an array: neither value is trustworthy.
  const rawToken = typeof token === 'string' && token.length > 0 ? token : null;
  const user = await getCurrentUser();

  return <VerifyEmailCard token={rawToken} signedIn={user !== null} />;
}
