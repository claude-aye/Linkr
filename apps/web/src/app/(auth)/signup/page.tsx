'use client';

import { type FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * Sign-up page (`/signup`) — the web door to `POST /auth/signup`.
 *
 * Structure, styles, state handling and post-success redirect are the sign-in
 * page's, deliberately: the two auth screens are twins. Signing up LOGS YOU IN
 * (the BFF poses the same cookie pair), so this lands on `/` exactly like a
 * sign-in — no second password prompt fifteen seconds later.
 *
 * Only four fields are asked. `countryCode` / `subdivisionCode` /
 * `preferredCurrency` are required by the DTO but pinned server-side in the BFF
 * (`QUEBEC_LOCALE_DEFAULTS`) — never here.
 */

/** The 409 branch is the only one that offers a way out, hence the flag. */
type FormError = { text: string; withLoginLink: boolean };

// Mirrors of `SignupDto`'s constraints (`@MinLength(8) @MaxLength(128)` on the
// password, `@MinLength(1) @MaxLength(100)` on the names). They do NOT replace
// server validation — they spare an obviously-doomed round-trip.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const NAME_MAX = 100;

/**
 * Maps the BFF status to frozen French copy. Mapping is by HTTP status ALONE —
 * the response body is never parsed to pick a message (convention locked since
 * 3.12b). Vouvoiement throughout.
 */
function errorForStatus(status: number): FormError {
  switch (status) {
    case 409:
      // The case that matters: say what happened AND what to do about it.
      return {
        text: 'Un compte existe déjà avec ce courriel.',
        withLoginLink: true,
      };
    case 400:
      return {
        text: 'Certains champs sont invalides. Veuillez les vérifier.',
        withLoginLink: false,
      };
    default:
      // 502 (BFF transport failure) and anything else — distinct from the 409
      // copy above, on purpose.
      return {
        text: 'Service momentanément indisponible. Veuillez réessayer.',
        withLoginLink: false,
      };
  }
}

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    // Light client validation — the API stays the real judge. No network call
    // on failure.
    if (!trimmedEmail || !password || !trimmedFirstName || !trimmedLastName) {
      setError({ text: 'Veuillez remplir tous les champs.', withLoginLink: false });
      return;
    }
    if (password.length < PASSWORD_MIN) {
      setError({
        text: `Le mot de passe doit contenir au moins ${PASSWORD_MIN} caractères.`,
        withLoginLink: false,
      });
      return;
    }
    if (trimmedFirstName.length > NAME_MAX || trimmedLastName.length > NAME_MAX) {
      setError({
        text: `Le prénom et le nom sont limités à ${NAME_MAX} caractères.`,
        withLoginLink: false,
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
        }),
      });

      if (!res.ok) {
        setError(errorForStatus(res.status));
        return;
      }

      // Cookies are now set (httpOnly) — the account is created AND signed in.
      // Land on the authenticated client hub, exactly like a sign-in.
      router.push('/');
      router.refresh();
    } catch {
      setError({
        text: 'Service momentanément indisponible. Veuillez réessayer.',
        withLoginLink: false,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800';
  const labelClass = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300';

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Créer un compte
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Rejoignez Linkr pour réserver un service ou en offrir un.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="firstName" className={labelClass}>
              Prénom
            </label>
            <input
              id="firstName"
              name="firstName"
              type="text"
              autoComplete="given-name"
              required
              maxLength={NAME_MAX}
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="lastName" className={labelClass}>
              Nom
            </label>
            <input
              id="lastName"
              name="lastName"
              type="text"
              autoComplete="family-name"
              required
              maxLength={NAME_MAX}
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="email" className={labelClass}>
              Courriel
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="password" className={labelClass}>
              Mot de passe
            </label>
            <input
              id="password"
              name="password"
              type="password"
              // `new-password` and NOT `current-password`: it tells password
              // managers to offer a generated one instead of autofilling an
              // existing credential.
              autoComplete="new-password"
              required
              maxLength={PASSWORD_MAX}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={fieldClass}
              aria-describedby="password-hint"
            />
            <p
              id="password-hint"
              className="mt-1 text-xs text-zinc-500 dark:text-zinc-400"
            >
              Au moins {PASSWORD_MIN} caractères.
            </p>
          </div>

          {/* `role="alert"` is the app-wide error convention (implicitly an
              assertive live region) — same markup as the sign-in page. */}
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {error.text}
              {error.withLoginLink && (
                <>
                  {' '}
                  <Link href="/login" className="font-medium underline underline-offset-2">
                    Connectez-vous.
                  </Link>
                </>
              )}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {submitting ? 'Création…' : 'Créer mon compte'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Vous avez déjà un compte?{' '}
          <Link
            href="/login"
            className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
          >
            Se connecter
          </Link>
        </p>
      </section>
    </main>
  );
}
