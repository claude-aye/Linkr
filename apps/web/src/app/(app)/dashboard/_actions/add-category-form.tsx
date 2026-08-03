'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * « Déclarer un métier » — the web door to
 * `POST /service-providers/{providerId}/categories`.
 *
 * Posts to the BFF `POST /api/service-providers/{providerId}/categories`, NOT a
 * Server Action — consistent with every other mutation in the app. One field: the
 * trade. Same form motif (and the exact same classes) as the other forms.
 *
 * ⚠️ REGULATED TRADES ARE PRESENTED BUT NOT SELECTABLE — this is a locked product
 * decision, NOT an oversight, and « enabling » them would fabricate a dead end.
 * Server-side, `ProviderServicesService.addCategory` files an INFORMAL claim as
 * `NOT_REQUIRED` (immediately eligible) and a REGULATED one as `PENDING`. Clearing
 * a PENDING claim takes a licence upload reviewed by an admin — a path that is out
 * of scope AND in fact blocked today, since an admin cannot even display the
 * document they are asked to approve. So a regulated declaration would sit at
 * PENDING forever with no way out.
 *
 * They are shown rather than hidden because a plumber who cannot find his trade
 * concludes Linkr does not cover it, whereas a plumber who sees it greyed out
 * understands he has to wait.
 */

/** One selectable (or deliberately non-selectable) trade. */
export interface TradeOption {
  id: string;
  /** Already resolved server-side via `pickTranslation`. */
  label: string;
  /** REGULATED → presented, disabled. See the header comment. */
  regulated: boolean;
}

export interface AddCategoryFormProps {
  providerId: string;
  /** Whole active catalog, ordered — regulated trades included, and disabled. */
  options: TradeOption[];
}

/** Frozen FR fallback for a BFF 502, a network failure, and any unmapped code. */
const UNAVAILABLE_MESSAGE = 'Service momentanément indisponible. Veuillez réessayer.';

/**
 * Maps a relayed BFF/API status to FROZEN French copy. Mapping is by HTTP status
 * ALONE — the response body is never parsed to pick a message (convention locked
 * since 3.12b). Vouvoiement throughout.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 409:
      // `ProviderCategoryConflictException` — this provider already has a
      // non-deleted claim on this trade. The one case that must say what to do.
      return 'Ce métier est déjà déclaré. Il figure dans la liste ci-dessus.';
    case 404:
      // The category vanished or was deactivated between render and submit
      // (the provider itself cannot 404 here — the dashboard just loaded it).
      return 'Ce métier n’est plus disponible. Veuillez actualiser la page.';
    case 403:
      return 'Vous n’êtes pas autorisé à modifier ce profil prestataire.';
    case 400:
      return 'Ce métier est invalide. Veuillez en choisir un autre.';
    case 401:
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    default:
      return UNAVAILABLE_MESSAGE;
  }
}

const fieldClass =
  'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800';
const labelClass = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300';
const hintClass = 'mt-1 text-xs text-zinc-500 dark:text-zinc-400';

export function AddCategoryForm({ providerId, options }: AddCategoryFormProps) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const hasOptions = options.length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    if (!categoryId) {
      setSucceeded(false);
      setError('Veuillez choisir un métier.');
      return;
    }

    setPending(true);
    setError(null);
    setSucceeded(false);

    let response: Response;
    try {
      response = await fetch(`/api/service-providers/${providerId}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceCategoryId: categoryId }),
      });
    } catch {
      setError(UNAVAILABLE_MESSAGE);
      setPending(false);
      return;
    }

    if (!response.ok) {
      setError(messageForStatus(response.status));
      setPending(false);
      return;
    }

    // Declared (201). Refresh so the Server Component re-reads the list and
    // renders the status the DATABASE holds — the confirmation below celebrates,
    // the badge above is the truth. Reset the select so the form is ready for a
    // second trade rather than re-offering the one just declared.
    setCategoryId('');
    setSucceeded(true);
    setPending(false);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div>
        <label htmlFor="serviceCategoryId" className={labelClass}>
          Ajouter un métier
        </label>
        <select
          id="serviceCategoryId"
          name="serviceCategoryId"
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            if (error) setError(null);
          }}
          disabled={pending || !hasOptions}
          className={fieldClass}
          aria-describedby="serviceCategoryId-hint"
        >
          <option value="">Choisir un métier</option>
          {options.map((option) => (
            <option key={option.id} value={option.id} disabled={option.regulated}>
              {/* The reason rides ON the option label, not only in the hint
                  below: a disabled option is announced with its own text, so
                  this is what a screen-reader user actually hears. */}
              {option.regulated
                ? `${option.label} — vérification de licence requise, bientôt disponible`
                : option.label}
            </option>
          ))}
        </select>
        <p id="serviceCategoryId-hint" className={hintClass}>
          Les métiers réglementés demandent une vérification de licence, pas encore
          disponible sur Linkr.
        </p>
      </div>

      {/* Live region present in the DOM even when empty — one inserted at the
          same time as its content is very often not announced at all. */}
      <div aria-live="polite">
        {succeeded && (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            Métier déclaré. Vous pouvez maintenant apparaître dans les résultats de
            recherche pour ce métier, selon votre rayon de service et la position du
            client.
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !hasOptions}
        className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Déclaration…' : 'Déclarer ce métier'}
      </button>
    </form>
  );
}
