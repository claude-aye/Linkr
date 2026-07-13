'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Maps a relayed API status to readable French text — never a stack/raw error. */
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'Requête invalide (motif manquant ?).';
    case 401:
      return 'Session expirée. Reconnecte-toi.';
    case 403:
      return 'Accès réservé aux administrateurs.';
    case 404:
      return 'Document introuvable (déjà retiré ?).';
    case 409:
      return 'Ce document a déjà été traité.';
    default:
      return 'Action impossible. Réessaie plus tard.';
  }
}

type Pending = null | 'approve' | 'reject';

/**
 * Per-document review actions (Phase 3.11c-A). Approve, or reveal a mandatory-reason
 * form and reject. On success → `router.refresh()`: the Server Component re-fetches
 * the PENDING queue (the sole source of truth) and the treated document disappears,
 * unmounting this component. No client-side copy of the queue.
 */
export function ReviewActions({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const busy = pending !== null;

  async function approve() {
    setError(null);
    setPending('approve');
    try {
      const res = await fetch(`/api/admin/verifications/${documentId}/approve`, {
        method: 'POST',
      });
      if (!res.ok) {
        setError(messageForStatus(res.status));
        return;
      }
      router.refresh();
    } catch {
      setError('Connexion impossible. Réessaie plus tard.');
    } finally {
      setPending(null);
    }
  }

  async function reject() {
    const motif = reason.trim();
    if (!motif) {
      // Client-side guard — the handler and the API both re-validate.
      setError('Le motif de rejet est obligatoire.');
      return;
    }
    setError(null);
    setPending('reject');
    try {
      const res = await fetch(`/api/admin/verifications/${documentId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectionReason: motif }),
      });
      if (!res.ok) {
        setError(messageForStatus(res.status));
        return;
      }
      router.refresh();
    } catch {
      setError('Connexion impossible. Réessaie plus tard.');
    } finally {
      setPending(null);
    }
  }

  function cancelReject() {
    setRejecting(false);
    setReason('');
    setError(null);
  }

  const approveClass =
    'rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60';
  const rejectClass =
    'rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950';
  const ghostClass =
    'rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';

  return (
    <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      {rejecting ? (
        <div className="space-y-2">
          <label
            htmlFor={`reason-${documentId}`}
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Motif du rejet <span className="text-red-600">*</span>
          </label>
          <textarea
            id={`reason-${documentId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Ex. : document illisible, numéro de licence introuvable…"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={reject}
              disabled={busy}
              className={rejectClass}
            >
              {pending === 'reject' ? 'Rejet…' : 'Confirmer le rejet'}
            </button>
            <button
              type="button"
              onClick={cancelReject}
              disabled={busy}
              className={ghostClass}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={approve}
            disabled={busy}
            className={approveClass}
          >
            {pending === 'approve' ? 'Approbation…' : 'Approuver'}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setRejecting(true);
            }}
            disabled={busy}
            className={rejectClass}
          >
            Rejeter
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
