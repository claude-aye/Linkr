'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  QUOTE_FIELD_ORDER,
  assembleQuote,
  type QuoteErrors,
  type QuoteField,
} from '@/lib/service-requests/tender-rules';

/**
 * The quote island of a tender card (PR 3 « Appel d'offres ») — the ONLY client
 * surface of the « Appels d'offres » tab. Everything else on the card (title,
 * trade, budget, window, deadline, distance) is resolved server-side; this
 * island owns what must react to a click: the collapsible form, the submit, and
 * the withdraw.
 *
 * Every conversion and every « may this leave ? » decision lives in the pure
 * module `lib/service-requests/tender-rules.ts` (tested under `node --test`):
 * hours → whole minutes, date → noon UTC, and `validUntilUtc` = the tender's
 * deadline + the selection window (R7). This file only wires state to it.
 *
 * Three shapes, driven by `myQuoteStatus` (the provider's LATEST quote on this
 * tender, as the feed reports it):
 *   - `null`                 → « Soumettre un devis » unfolds the form;
 *   - `SUBMITTED`            → « Devis envoyé » + « Retirer mon devis »;
 *   - `WITHDRAWN`/`EXPIRED`  → the state is said, and the form is available again.
 * `ACCEPTED` / `REJECTED` cannot coexist with an OPEN tender (acceptance moves
 * the request to ASSIGNED and rejects the siblings in the same transaction), so
 * the feed never carries them; they fall through to the form branch rather than
 * crash.
 */
export interface TenderQuoteActionProps {
  tenderId: string;
  /** Tender title, repeated in the withdraw confirmation. */
  title: string;
  /** The tender's quotes deadline — the base of the quote's validity. */
  quotesDeadlineUtc: string;
  myQuoteId: string | null;
  myQuoteStatus: 'SUBMITTED' | 'WITHDRAWN' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | null;
}

const UNEXPECTED_MESSAGE =
  'Service momentanément indisponible. Veuillez réessayer plus tard.';

/**
 * Submit errors → FROZEN French copy, BY HTTP STATUS ALONE (lock 3.12b): the
 * body is never read to pick a message. The 409 covers two causes the status
 * cannot tell apart — the tender stopped taking quotes (deadline passed,
 * expired, assigned), or a live quote of his already exists — so the copy
 * names both and offers to refresh, which shows which one it was.
 */
function submitMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Certaines informations de votre devis sont invalides. Veuillez vérifier votre saisie.';
    case 403:
      return 'Vous ne pouvez pas soumettre de devis sur cet appel d’offres.';
    case 404:
      return 'Cet appel d’offres est introuvable.';
    case 409:
      return 'Cet appel d’offres n’accepte plus de devis, ou vous avez déjà un devis actif. Actualisez la page pour voir son état actuel.';
    default:
      return UNEXPECTED_MESSAGE;
  }
}

/** Withdraw errors → FROZEN French copy, by HTTP status alone. */
function withdrawMessage(status: number): string {
  switch (status) {
    case 403:
    case 404:
      return 'Ce devis est introuvable.';
    case 409:
      return 'Ce devis ne peut plus être retiré.';
    default:
      return UNEXPECTED_MESSAGE;
  }
}

/** Today as a `YYYY-MM-DD` date-field value, from LOCAL parts (never `toISOString`). */
function todayDateValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const fieldClass =
  'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 aria-[invalid=true]:border-red-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800 dark:aria-[invalid=true]:border-red-700';
const labelClass = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300';
const hintClass = 'mt-1 text-xs text-zinc-500 dark:text-zinc-400';
const fieldErrorClass = 'mt-1 text-xs font-medium text-red-700 dark:text-red-400';
const secondaryButtonClass =
  'min-h-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
const primaryButtonClass =
  'min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60';

const EMPTY_DRAFT = { amount: '', durationHours: '', description: '', proposedStartDate: '' };

export function TenderQuoteAction({
  tenderId,
  title,
  quotesDeadlineUtc,
  myQuoteId,
  myQuoteStatus,
}: TenderQuoteActionProps) {
  const router = useRouter();
  const idBase = useId();
  const formId = `${idBase}-form`;
  const fieldId = (field: QuoteField) => `${idBase}-${field}`;
  const errorId = (field: QuoteField) => `${idBase}-${field}-error`;

  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [errors, setErrors] = useState<QuoteErrors>({});
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<{ message: string; refresh: boolean } | null>(
    null,
  );
  // Announced through the polite region below — present in the DOM even when
  // empty, because a region inserted together with its content is often not
  // announced at all.
  const [announcement, setAnnouncement] = useState('');
  // Set on unfold, in an event handler — never computed during render, so the
  // server HTML and the first client render can never disagree on « today ».
  const [minDate, setMinDate] = useState<string | undefined>(undefined);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  function update(field: keyof typeof EMPTY_DRAFT, errorField: QuoteField, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    setErrors((e) => {
      if (!e[errorField]) return e;
      const next = { ...e };
      delete next[errorField];
      return next;
    });
  }

  function toggle() {
    if (!expanded) setMinDate(todayDateValue());
    setExpanded((v) => !v);
    setServerError(null);
  }

  /** `aria-describedby`: the hint always (when there is one), the error when there is one. */
  function describedBy(field: QuoteField, hint?: string): string | undefined {
    const ids = [hint, errors[field] ? errorId(field) : undefined].filter(Boolean);
    return ids.length > 0 ? ids.join(' ') : undefined;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setServerError(null);

    const result = assembleQuote(draft, quotesDeadlineUtc);
    if (result.kind === 'invalid') {
      setErrors(result.errors);
      // One summary in the alert region; the detail sits at each field.
      setServerError({ message: 'Veuillez corriger les champs signalés.', refresh: false });
      const first = QUOTE_FIELD_ORDER.find((field) => result.errors[field]);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    if (result.kind === 'no-deadline') {
      setServerError({ message: UNEXPECTED_MESSAGE, refresh: false });
      return;
    }

    setErrors({});
    setPending(true);
    try {
      const res = await fetch(`/api/service-requests/${tenderId}/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.body),
      });
      if (!res.ok) {
        // A 400 was not expected — the module mirrors the DTO. Its detail goes
        // to the console, never to the screen (the body is not read for copy).
        if (res.status === 400) {
          console.error('Quote refused (400):', await res.json().catch(() => null));
        }
        setServerError({ message: submitMessage(res.status), refresh: res.status === 409 });
        setPending(false);
        return;
      }
      setAnnouncement('Votre devis a été envoyé.');
      // The Server Component is the source of truth: re-read rather than patch
      // local state. `pending` stays true while the refresh lands, so a second
      // click cannot fire a second quote (which the API would 409 anyway).
      router.refresh();
    } catch {
      setServerError({ message: UNEXPECTED_MESSAGE, refresh: false });
      setPending(false);
    }
  }

  async function confirmWithdraw(): Promise<void> {
    if (!myQuoteId) throw new Error(withdrawMessage(404));
    let res: Response;
    try {
      res = await fetch(`/api/quotes/${myQuoteId}/withdraw`, { method: 'POST' });
    } catch {
      throw new Error(UNEXPECTED_MESSAGE);
    }
    if (!res.ok) throw new Error(withdrawMessage(res.status));

    // This island SURVIVES the refresh (same card, same position), so the state
    // of the earlier submit must be reset here — otherwise the form would come
    // back with its button still stuck on « Envoi… ».
    setPending(false);
    setExpanded(false);
    setDraft(EMPTY_DRAFT);
    setErrors({});
    setServerError(null);
    setAnnouncement('Votre devis a été retiré. Vous pouvez en soumettre un nouveau.');
    router.refresh();
  }

  const live = (
    <p aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );

  if (myQuoteStatus === 'SUBMITTED') {
    return (
      <div className="mt-4">
        {live}
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            Devis envoyé
          </span>
          <button
            type="button"
            onClick={() => setWithdrawOpen(true)}
            className={secondaryButtonClass}
          >
            Retirer mon devis
          </button>
        </div>
        <p className={hintClass}>
          Le client choisira parmi les devis reçus après la date limite.
        </p>

        <ConfirmDialog
          isOpen={withdrawOpen}
          onClose={() => setWithdrawOpen(false)}
          title="Retirer votre devis ?"
          confirmLabel="Retirer mon devis"
          onConfirm={confirmWithdraw}
        >
          <p>
            Votre devis pour{' '}
            <span className="font-medium text-zinc-800 dark:text-zinc-200">{title}</span>{' '}
            ne sera plus proposé au client.
          </p>
          <p className="mt-2">
            Vous pourrez en soumettre un nouveau tant que l’appel d’offres reçoit des devis.
          </p>
        </ConfirmDialog>
      </div>
    );
  }

  const stateNotice =
    myQuoteStatus === 'WITHDRAWN'
      ? 'Vous avez retiré votre devis. Vous pouvez en soumettre un nouveau.'
      : myQuoteStatus === 'EXPIRED'
        ? 'Votre devis a expiré. Vous pouvez en soumettre un nouveau.'
        : null;

  return (
    <div className="mt-4">
      {live}
      {stateNotice && (
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">{stateNotice}</p>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={formId}
        className={expanded ? secondaryButtonClass : primaryButtonClass}
      >
        {expanded ? 'Fermer le formulaire' : 'Soumettre un devis'}
      </button>

      {expanded && (
        <form
          id={formId}
          method="post"
          onSubmit={submit}
          noValidate
          className="mt-4 space-y-4 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-950"
        >
          {/* Montant */}
          <div>
            <label htmlFor={fieldId('amount')} className={labelClass}>
              Montant de votre devis
            </label>
            <div className="relative">
              <input
                id={fieldId('amount')}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={draft.amount}
                onChange={(event) => update('amount', 'amount', event.target.value)}
                className={`${fieldClass} pr-14`}
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={describedBy('amount', `${idBase}-amount-hint`)}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-3 mt-1 flex items-center text-sm text-zinc-500 dark:text-zinc-400"
              >
                $ CA
              </span>
            </div>
            <p id={`${idBase}-amount-hint`} className={hintClass}>
              En dollars canadiens, par exemple 850 ou 850,50.
            </p>
            {errors.amount && (
              <p id={errorId('amount')} className={fieldErrorClass}>
                {errors.amount}
              </p>
            )}
          </div>

          {/* Durée estimée */}
          <div>
            <label htmlFor={fieldId('duration')} className={labelClass}>
              Durée estimée (heures)
            </label>
            <input
              id={fieldId('duration')}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={draft.durationHours}
              onChange={(event) => update('durationHours', 'duration', event.target.value)}
              className={fieldClass}
              aria-invalid={errors.duration ? true : undefined}
              aria-describedby={describedBy('duration', `${idBase}-duration-hint`)}
            />
            <p id={`${idBase}-duration-hint`} className={hintClass}>
              Par demi-heure, par exemple 1,5 pour une heure et demie.
            </p>
            {errors.duration && (
              <p id={errorId('duration')} className={fieldErrorClass}>
                {errors.duration}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label htmlFor={fieldId('description')} className={labelClass}>
              Description de votre devis
            </label>
            <textarea
              id={fieldId('description')}
              rows={4}
              value={draft.description}
              onChange={(event) => update('description', 'description', event.target.value)}
              className={fieldClass}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={describedBy('description', `${idBase}-description-hint`)}
            />
            <p id={`${idBase}-description-hint`} className={hintClass}>
              Ce que comprend votre prix : travaux, matériaux, déplacement.
            </p>
            {errors.description && (
              <p id={errorId('description')} className={fieldErrorClass}>
                {errors.description}
              </p>
            )}
          </div>

          {/* Date de début proposée — facultative */}
          <div>
            <label htmlFor={fieldId('proposedStart')} className={labelClass}>
              Date de début proposée
            </label>
            <input
              id={fieldId('proposedStart')}
              type="date"
              // A courtesy that narrows the picker — no server rule exists on
              // this date, so nothing else enforces it.
              min={minDate}
              value={draft.proposedStartDate}
              onChange={(event) =>
                update('proposedStartDate', 'proposedStart', event.target.value)
              }
              className={fieldClass}
              aria-invalid={errors.proposedStart ? true : undefined}
              aria-describedby={describedBy('proposedStart', `${idBase}-proposedStart-hint`)}
            />
            <p id={`${idBase}-proposedStart-hint`} className={hintClass}>
              Facultatif.
            </p>
            {errors.proposedStart && (
              <p id={errorId('proposedStart')} className={fieldErrorClass}>
                {errors.proposedStart}
              </p>
            )}
          </div>

          <p className={hintClass}>
            Votre devis restera valide jusqu’à la fin de la période où le client choisit
            parmi les devis reçus.
          </p>

          {serverError && (
            <div
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              <p>{serverError.message}</p>
              {serverError.refresh && (
                <button
                  type="button"
                  onClick={() => router.refresh()}
                  className="mt-2 min-h-11 font-medium underline underline-offset-2"
                >
                  Actualiser la page
                </button>
              )}
            </div>
          )}

          <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
            {pending ? 'Envoi…' : 'Envoyer mon devis'}
          </button>
        </form>
      )}
    </div>
  );
}
