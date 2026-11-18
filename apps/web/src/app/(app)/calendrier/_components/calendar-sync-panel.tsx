'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  CALENDAR_EXPORT_PATH,
  type FeedLinks,
  feedErrorMessage,
  feedLinks,
} from '@/lib/calendar/calendar-rules';
import { EMAIL_NOT_VERIFIED_MESSAGE, isEmailNotVerified } from '@/lib/email-verification/states';

import {
  dangerButtonClass,
  errorClass,
  ghostButtonClass,
  hintClass,
  inputClass,
  labelClass,
  primaryButtonClass,
} from './styles';

/**
 * Synchronisation with an outside calendar (Outlook, Google Calendar, Apple
 * Calendar…): a subscription link that stays up to date, and a one-off `.ics`
 * download.
 *
 * ⚠️ THE LINK IS SHOWN ONCE. It is a bearer secret (a calendar app sends no
 * session), so the API keeps only its hash — exactly like a password-reset
 * link. Once this panel is unmounted the address cannot be shown again:
 * « Générer un nouveau lien » makes another one and switches the old one off.
 * The screen says so BEFORE the click, not after.
 *
 * The address is built from `window.location.origin`, in the click handler —
 * never during render, so the server and the first client render agree.
 */
export function CalendarSyncPanel({
  feedEnabled,
  feedSinceLabel,
}: {
  feedEnabled: boolean;
  /** « 16 nov. 2026 » — when the active link was generated. */
  feedSinceLabel: string | null;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [links, setLinks] = useState<FeedLinks | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<'regenerate' | 'revoke' | null>(null);
  const urlId = useId();

  /** Throws a French message on failure (the ConfirmDialog shows it verbatim). */
  async function generate(): Promise<void> {
    let response: Response;
    try {
      response = await fetch('/api/service-providers/me/calendar/feed', { method: 'POST' });
    } catch {
      throw new Error(feedErrorMessage(0));
    }
    if (!response.ok) {
      const notVerified = await isEmailNotVerified(response);
      throw new Error(notVerified ? EMAIL_NOT_VERIFIED_MESSAGE : feedErrorMessage(response.status));
    }
    let path: unknown;
    try {
      path = ((await response.json()) as { path?: unknown }).path;
    } catch {
      path = null;
    }
    if (typeof path !== 'string') throw new Error(feedErrorMessage(0));
    setLinks(feedLinks(window.location.origin, path));
    setCopied(false);
    startRefresh(() => router.refresh());
  }

  async function firstLink() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await generate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : feedErrorMessage(0));
    } finally {
      setPending(false);
    }
  }

  async function revoke(): Promise<void> {
    let response: Response;
    try {
      response = await fetch('/api/service-providers/me/calendar/feed', { method: 'DELETE' });
    } catch {
      throw new Error(feedErrorMessage(0));
    }
    if (!response.ok) throw new Error(feedErrorMessage(response.status));
    setLinks(null);
    startRefresh(() => router.refresh());
  }

  async function copy() {
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links.httpsUrl);
      setCopied(true);
    } catch {
      // No clipboard access (insecure origin, permission): the field is
      // selectable, the address can still be copied by hand.
      setCopied(false);
    }
  }

  const active = feedEnabled || links !== null;

  return (
    <div className="space-y-5">
      <p className={hintClass}>
        Affichez vos rendez-vous Linkr dans Outlook, Google Agenda ou Calendrier Apple. Par respect
        pour vos clients, ni leur nom, ni leur adresse, ni le titre de leur demande ne quittent
        Linkr : chaque rendez-vous porte le nom du métier et du service, et un lien vers ce
        calendrier. Vos indisponibilités y figurent sous le seul titre « Indisponible » : vos notes
        restent dans Linkr.
      </p>

      <div className="space-y-3 rounded-2xl border border-edge bg-surface p-4">
        <h3 className="text-sm font-semibold text-text">Abonnement (mise à jour automatique)</h3>

        {links ? (
          <div className="space-y-3">
            <div>
              <label htmlFor={urlId} className={labelClass}>
                Adresse de votre calendrier
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <input
                  id={urlId}
                  type="text"
                  readOnly
                  value={links.httpsUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className={`${inputClass} font-mono text-sm`}
                />
                <button type="button" onClick={copy} className={`${primaryButtonClass} shrink-0`}>
                  {copied ? 'Copiée' : 'Copier'}
                </button>
              </div>
              <p aria-live="polite" className="sr-only">
                {copied ? 'Adresse copiée.' : ''}
              </p>
            </div>

            <p className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Copiez cette adresse maintenant : elle ne sera plus affichée.
            </p>

            <div className="flex flex-wrap gap-2">
              <a
                href={links.googleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={ghostButtonClass}
              >
                Ajouter à Google Agenda
              </a>
              <a
                href={links.outlookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={ghostButtonClass}
              >
                Ajouter à Outlook
              </a>
              <a href={links.webcalUrl} className={ghostButtonClass}>
                Ouvrir dans mon application
              </a>
            </div>
            <p className="text-xs text-text-muted">
              Dans une autre application, cherchez « S’abonner à un calendrier » ou « Ajouter à
              partir d’une URL », puis collez l’adresse. Les changements apparaissent au rythme de
              votre application, souvent en quelques heures.
            </p>
          </div>
        ) : active ? (
          <p className="text-sm text-text">
            Un lien d’abonnement est actif
            {feedSinceLabel ? ` depuis le ${feedSinceLabel}` : ''}. Pour des raisons de sécurité,
            son adresse n’est affichée qu’au moment où elle est générée.
          </p>
        ) : (
          <p className="text-sm text-text-muted">Aucun lien d’abonnement pour le moment.</p>
        )}

        {/* Decision of 17 November 2026, verbatim. Shown as long as a link is
            active — not only at the moment it is generated — because it is
            the sentence that makes « Désactiver » make sense. */}
        {active && (
          <p className="text-sm font-medium text-text">
            Toute personne qui possède ce lien voit votre agenda. Désactivez-le s’il a été partagé
            par erreur.
          </p>
        )}

        {error && (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {active ? (
            <>
              <button
                type="button"
                onClick={() => setConfirm('regenerate')}
                className={ghostButtonClass}
              >
                Générer un nouveau lien
              </button>
              <button
                type="button"
                onClick={() => setConfirm('revoke')}
                className={dangerButtonClass}
              >
                Désactiver le lien
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={firstLink}
              disabled={pending}
              className={primaryButtonClass}
            >
              {pending ? 'Génération…' : 'Générer mon lien d’abonnement'}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-edge bg-surface p-4">
        <h3 className="text-sm font-semibold text-text">Export ponctuel</h3>
        <p className={hintClass}>
          Téléchargez un fichier .ics de vos rendez-vous (30 derniers jours et 6 prochains mois)
          pour l’importer une fois dans votre calendrier. Il ne se mettra pas à jour.
        </p>
        {/* A plain link: the download is a navigation the browser handles, with
            the session cookie — nothing to fetch from script. */}
        <a href={CALENDAR_EXPORT_PATH} download className={ghostButtonClass}>
          Télécharger le fichier .ics
        </a>
      </div>

      <ConfirmDialog
        isOpen={confirm === 'regenerate'}
        onClose={() => setConfirm(null)}
        title="Générer un nouveau lien ?"
        confirmLabel="Générer"
        onConfirm={generate}
      >
        <p className="text-sm text-text-muted">
          L’ancien lien cessera de fonctionner tout de suite : les calendriers qui l’utilisent ne se
          mettront plus à jour tant que vous n’y aurez pas collé la nouvelle adresse.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={confirm === 'revoke'}
        onClose={() => setConfirm(null)}
        title="Désactiver le lien d’abonnement ?"
        confirmLabel="Désactiver"
        onConfirm={revoke}
      >
        <p className="text-sm text-text-muted">
          Les calendriers abonnés ne recevront plus vos rendez-vous. Vous pourrez générer un nouveau
          lien à tout moment.
        </p>
      </ConfirmDialog>
    </div>
  );
}
