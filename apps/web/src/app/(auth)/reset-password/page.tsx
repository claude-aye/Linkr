/**
 * Choose a new password (`/reset-password?token=…`).
 *
 * Server Component + client form, the house pattern (`requests/new/`): the token
 * is read from `searchParams` server-side and handed down as a prop, so the form
 * never has to derive state from the URL inside an effect — and there is no
 * server/client mismatch to guard against.
 *
 * This reads the token but does NOT act on it. Only the form's POST consumes it
 * (A-2.7): mail-scanning antivirus and link previewers fetch URLs before a human
 * clicks, and a GET that consumed would burn the token before its owner saw it.
 * Rendering this page must therefore stay free of side effects.
 */
import { ResetPasswordForm } from './reset-password-form';

export default async function ResetPasswordPage({
  searchParams,
}: {
  // A Promise in Next 16.
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  // `?token=a&token=b` arrives as an array; neither value is trustworthy, so
  // treat it as no token at all rather than picking one.
  const rawToken = typeof token === 'string' && token.length > 0 ? token : null;

  return <ResetPasswordForm token={rawToken} />;
}
