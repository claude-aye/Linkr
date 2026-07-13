'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Pipeline advancement action for a job assigned to the provider (Phase B,
 * PR 2 — the fourth and last action component, the ONLY one that does NOT use
 * {@link import('@/components/ui/confirm-dialog').ConfirmDialog}).
 *
 * A single component drives BOTH forward transitions, selected by `status`:
 *   - ASSIGNED     → « Démarrer »   → POST /api/service-requests/{id}/start
 *   - IN_PROGRESS  → « Compléter »  → POST /api/service-requests/{id}/complete
 *   - anything else → renders nothing (returns `null`)
 *
 * Both transitions are financially INERT: server-side, a provider marking a job
 * started or done triggers NO Stripe capture (the balance is captured later by
 * the client or a cron, never here). They are also reversible in the pipeline.
 * So there is NO confirmation dialog — a direct click, guarded only by a
 * `pending` state (anti double-click). Errors surface INLINE under the button.
 */
export interface JobPipelineActionProps {
  requestId: string;
  /**
   * Current status of the mandate. The component only acts on ASSIGNED /
   * IN_PROGRESS; any other value renders nothing. Typed as a plain string
   * (locked prop contract) — the wiring passes the request's status through.
   */
  status: string;
}

/** Frozen FR fallback for any unmapped status and for network/transport errors. */
const UNEXPECTED_MESSAGE =
  'Une erreur inattendue est survenue. Veuillez réessayer plus tard.';

/** Frozen FR copy for the 409 desync (see the 409 special handling below). */
const CONFLICT_MESSAGE =
  "Ce mandat n'est plus dans l'état attendu. La page va être actualisée.";

/** Frozen FR copy for a vanished mandate. */
const NOT_FOUND_MESSAGE = "Ce mandat n'est plus accessible.";

/**
 * Maps a relayed API status to the FROZEN French copy (see PR spec). Decision is
 * locked: mapping is by HTTP status ALONE — the response body is never parsed.
 *
 * Only 409 and 404 are mapped: these transitions touch no Stripe (no 502) and
 * need no amount (no 422), so those codes cannot arise here — everything else,
 * including a BFF 502 on transport failure, falls through to the generic copy.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 409:
      return CONFLICT_MESSAGE;
    case 404:
      return NOT_FOUND_MESSAGE;
    default:
      return UNEXPECTED_MESSAGE;
  }
}

interface PipelineStep {
  /** BFF sub-path — the `{start|complete}` segment of the POST URL. */
  action: 'start' | 'complete';
  label: string;
  /** Per-action button classes; « Compléter » is a touch more affirmed. */
  className: string;
}

/** The two actionable statuses. Any status absent here → the component is inert. */
const PIPELINE_STEPS: Record<string, PipelineStep> = {
  ASSIGNED: {
    action: 'start',
    label: 'Démarrer',
    // Neutral primary (mirrors ConfirmDialog's confirm button tone).
    className:
      'bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200',
  },
  IN_PROGRESS: {
    action: 'complete',
    label: 'Compléter',
    // Slightly more affirmed than « Démarrer » — completing is a milestone.
    className: 'bg-blue-600 text-white hover:bg-blue-500',
  },
};

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export function JobPipelineAction({ requestId, status }: JobPipelineActionProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Status-driven: outside ASSIGNED / IN_PROGRESS the component renders nothing.
  // Explicit `| undefined` so the guard narrows under any tsconfig (this project
  // has strict on but noUncheckedIndexedAccess off).
  const step: PipelineStep | undefined = PIPELINE_STEPS[status];
  if (!step) return null;
  // Destructure after the guard: plain concrete consts, no closure-narrowing
  // question when `action` is captured by handleAction below.
  const { action, label, className } = step;

  async function handleAction(): Promise<void> {
    setError(null);
    setPending(true);

    let response: Response;
    try {
      // Same BFF channel as accept/decline: same-origin POST, cookies sent. NO
      // body — start/complete carry no payload.
      response = await fetch(`/api/service-requests/${requestId}/${action}`, {
        method: 'POST',
      });
    } catch {
      // Network/transport failure → the "unexpected" bucket of the frozen table.
      // No refresh: nothing changed server-side.
      setError(UNEXPECTED_MESSAGE);
      setPending(false);
      return;
    }

    if (!response.ok) {
      // Status-only mapping (locked). Shown verbatim inline under the button.
      setError(messageForStatus(response.status));
      setPending(false);
      // A 409 means the display went stale (the mandate changed state between
      // render and click). Show the message AND auto-refresh so the card
      // resyncs with the real state. 404 / fallback show the message only.
      if (response.status === 409) {
        router.refresh();
      }
      return;
    }

    // Success: the request advanced in the pipeline server-side. Refresh so the
    // Server Component re-fetches — the button switches (Démarrer→Compléter) or
    // disappears once the status leaves ASSIGNED / IN_PROGRESS.
    router.refresh();
    setPending(false);
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={handleAction}
        disabled={pending}
        aria-busy={pending}
        className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      >
        {pending && <Spinner />}
        {label}
      </button>

      {error && (
        <p
          role="alert"
          className="max-w-sm rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
