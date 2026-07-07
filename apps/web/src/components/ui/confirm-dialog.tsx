'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  /** Cancel / backdrop / Échap — the parent flips its `isOpen` to false. */
  onClose: () => void;
  title: string;
  /** Dialog body, injected by the consumer. */
  children: ReactNode;
  /** Label of the confirmation button. */
  confirmLabel: string;
  /**
   * When true, the confirm button is disabled (the action is impossible for the
   * current input — e.g. a booking with no estimated amount). Cancel stays
   * available. Defaults to `false`, i.e. the exact prior behavior — strictly
   * backward-compatible for existing callers.
   */
  confirmDisabled?: boolean;
  /**
   * Runs on confirm. RESOLVES on success (the dialog closes) or REJECTS with an
   * `Error` whose message is already in French — shown verbatim, never mapped.
   */
  onConfirm: () => Promise<void>;
}

/**
 * Reusable confirmation dialog built on the native HTML `<dialog>` element
 * (`showModal()` / `close()`), so the focus trap, background inertness and the
 * Escape key come from the platform — we never reimplement them.
 *
 * Agnostic by design: no business logic, no network, no HTTP/status mapping.
 * It only orchestrates the open/pending/error lifecycle and renders the body a
 * consumer injects via `children`. Two consumers (Accept modal, Decline
 * AlertDialog) will build on it in a later step.
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  title,
  children,
  confirmLabel,
  confirmDisabled = false,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The parent's `isOpen` is the single source of truth. showModal()/close()
  // are imperative and throw / no-op depending on the current `open` state, so
  // guard each call with `dialog.open`.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      // Fresh open — drop any transient state from a previous cycle.
      setError(null);
      setPending(false);
      dialog.showModal();
      // Land focus on the safe action (Cancel), never on Confirm.
      cancelButtonRef.current?.focus();
    } else if (!isOpen && dialog.open) {
      // close() restores focus to the trigger natively.
      dialog.close();
    }
  }, [isOpen]);

  async function handleConfirm() {
    setError(null);
    setPending(true);
    try {
      await onConfirm();
      // Resolved → hand control back to the parent; its `isOpen` flip drives
      // the effect above to close(). `pending` is intentionally left set: the
      // next open resets it, avoiding a re-enabled flash before the close.
      onClose();
    } catch (err) {
      // The message is already French, prepared by the caller. Display it as
      // is — never map or translate. Fall back defensively only if a non-Error
      // (or an empty message) somehow slips through.
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Une erreur est survenue. Réessaie.',
      );
      setPending(false);
    }
  }

  // Cancel / backdrop / Échap all funnel here; neutralised while a confirm is
  // in flight so the pending action can never be abandoned mid-way.
  function requestClose() {
    if (pending) return;
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Escape fires `cancel`: always preventDefault so the native close never
      // desyncs from the parent's `isOpen`, then route through requestClose.
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      // Backdrop click: the padding-less <dialog> is only the event target when
      // the click lands outside its inner card.
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
      // `m-auto` restores centering: Tailwind's Preflight resets `margin: 0` on
      // every element, which clobbers the UA's `dialog:modal { margin: auto }`
      // (the modal's zeroed insets remain, so `auto` margins re-center it).
      className="m-auto w-[92vw] max-w-md border-0 bg-transparent p-0 backdrop:bg-zinc-950/50"
    >
      <div className="max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <h2
          id={titleId}
          className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          {title}
        </h2>

        <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {children}
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={requestClose}
            disabled={pending}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending || confirmDisabled}
            aria-busy={pending}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {pending && (
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
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
