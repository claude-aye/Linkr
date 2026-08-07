'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * « Notifications » — the read surface of a table that, until PR B, no route
 * exposed at all. One provider-facing section on the dashboard.
 *
 * WHY A CLIENT ISLAND AT ALL, when every other dashboard section is a plain
 * Server Component: the unread counter has to fall the moment a row is clicked,
 * without a full reload, and the row that was clicked has to stop looking new.
 * `router.refresh()` cannot serve that here — a click also NAVIGATES away, so
 * there is no current page left to re-render. Hence a local optimistic state,
 * seeded by the server-rendered envelope.
 *
 * The island owns the whole `<section>` (heading + badge + list) because the
 * counter lives in the heading and the read marks live in the rows: splitting
 * them would need a context to share one `Set`, for no gain.
 *
 * Everything that needs formatting, i18n or a status badge is resolved
 * SERVER-SIDE and arrives as plain props (see `NotificationView`) — this file
 * holds no `pickTranslation`, no `Intl`, and no second status map.
 */

/** One notification, fully resolved server-side. */
export interface NotificationView {
  id: string;
  /** Unread AT RENDER TIME. Only these can decrement the counter. */
  unread: boolean;
  /** The request's title, or a sober stand-in when none is joined. */
  title: string;
  /** Trade (métier), i18n-resolved server-side. Null when nothing is joined. */
  tradeLabel: string | null;
  /**
   * The request's REAL current status — resolved against the dashboard's own
   * `STATUS_BADGES` (which stays a non-exported local const there, so the
   * tracked « shared status helper » debt is neither widened nor paid here).
   * Null when the notification points at no request.
   */
  badge: { label: string; className: string } | null;
  /** Relative timestamp, computed server-side at render (see the page). */
  timeLabel: string;
  /** Absolute timestamp, shown on hover — the relative one is a snapshot. */
  timeTitle: string;
  /**
   * Where the row leads, or null when there is nowhere to go: a notification
   * carrying no request, or one whose request has been soft-deleted. Such rows
   * still mark themselves read — they are just not links.
   */
  href: string | null;
}

export interface NotificationsSectionProps {
  items: NotificationView[];
  /**
   * Unread across the WHOLE set, straight from the envelope — NEVER recomputed
   * from `items`, which the API caps at 50: a count derived from the page would
   * under-report as soon as the cap bites.
   */
  unreadCount: number;
  /** Total before the cap, used only to admit the truncation out loud. */
  total: number;
}

export function NotificationsSection({
  items,
  unreadCount,
  total,
}: NotificationsSectionProps) {
  // Ids marked read in THIS session, optimistically. Only ever holds ids that
  // were unread server-side, so the subtraction below cannot over-count.
  const [markedRead, setMarkedRead] = useState<ReadonlySet<string>>(new Set());

  // The server figure minus what we just marked — a decrement of the envelope,
  // not a recount of the page. Clamped defensively.
  const unread = Math.max(0, unreadCount - markedRead.size);

  async function markRead(id: string, wasUnread: boolean): Promise<void> {
    if (!wasUnread || markedRead.has(id)) return;

    // Optimistic: the counter and the row update before the round trip.
    setMarkedRead((previous) => new Set(previous).add(id));

    const revert = () =>
      setMarkedRead((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });

    let response: Response;
    try {
      // Same BFF channel as every other mutation. The API is idempotent, so a
      // reverted row can simply be clicked again.
      response = await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    } catch {
      // Network/transport failure — an optimistic decrement left standing would
      // lie about the server's state, so put it back.
      revert();
      return;
    }

    if (!response.ok) revert();
  }

  return (
    <section aria-labelledby="notifications-title">
      <div className="mb-3 flex items-center gap-2">
        <h2
          id="notifications-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Notifications
        </h2>
        {/* Live region: the count changes on click, with no navigation of its
            own to announce it. Present in the DOM even at zero — a region
            inserted at the same time as its content is often not announced. */}
        <span aria-live="polite">
          {unread > 0 && (
            <span className="inline-flex items-center rounded-full bg-blue-600 px-2.5 py-0.5 text-sm font-medium text-white">
              {unread}
              <span className="sr-only">{unread > 1 ? ' non lues' : ' non lue'}</span>
            </span>
          )}
        </span>
      </div>

      {items.length === 0 ? (
        // Same dashed shell as the page's `EmptyHint`. That helper lives in the
        // Server Component page and cannot be imported across the client
        // boundary, so its classes are mirrored here rather than exported.
        <div className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Aucune notification pour le moment.
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                read={!item.unread || markedRead.has(item.id)}
                onActivate={() => void markRead(item.id, item.unread)}
              />
            ))}
          </ul>
          {total > items.length && (
            // The cap is a server constant and paging is out of scope — say so
            // rather than let the list look complete.
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Les {items.length} plus récentes sur {total}.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function NotificationRow({
  item,
  read,
  onActivate,
}: {
  item: NotificationView;
  read: boolean;
  onActivate: () => void;
}) {
  const body = <NotificationBody item={item} read={read} />;

  const shell =
    'block w-full rounded-2xl border p-4 text-left shadow-sm transition ' +
    (read
      ? 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700'
      : 'border-blue-300/70 bg-blue-50/40 hover:border-blue-400 dark:border-blue-900 dark:bg-blue-950/20 dark:hover:border-blue-800');

  return (
    <li>
      {item.href ? (
        // A real `<Link>`, not a programmatic push: navigation is then the
        // link's own job and CANNOT be held up — or cancelled — by the PATCH.
        // `onClick` (rather than `onNavigate`) so a Ctrl/Cmd-click, which opens
        // a new tab instead of navigating, still marks the row read.
        <Link href={item.href} onClick={onActivate} className={shell}>
          {body}
        </Link>
      ) : (
        // Nowhere to lead (no request, or a soft-deleted one) — still readable.
        <button type="button" onClick={onActivate} className={shell}>
          {body}
        </button>
      )}
    </li>
  );
}

function NotificationBody({ item, read }: { item: NotificationView; read: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {!read && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-blue-600"
              aria-hidden="true"
            />
          )}
          <span
            className={
              read
                ? 'font-medium text-zinc-700 dark:text-zinc-300'
                : 'font-semibold text-zinc-900 dark:text-zinc-50'
            }
          >
            {!read && <span className="sr-only">Non lue. </span>}
            {item.title}
          </span>
        </div>
        <span
          className="text-xs text-zinc-500 dark:text-zinc-400"
          title={item.timeTitle}
        >
          {item.timeLabel}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {item.tradeLabel && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {item.tradeLabel}
          </span>
        )}
        {item.badge && (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${item.badge.className}`}
          >
            {item.badge.label}
          </span>
        )}
      </div>
    </>
  );
}
