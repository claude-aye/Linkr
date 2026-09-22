/**
 * `<input type="datetime-local">` ⇄ instant — the two directions, in one place.
 *
 * The field speaks WALL TIME with no zone (« YYYY-MM-DDTHH:mm »), and both
 * directions here read and write it in the BROWSER's zone.
 *
 * ⚠️ DETTE D0b, ASSUMÉE (CLAUDE.md §13.1 nº 17(e)) — the conversion uses the
 * browser's zone, NOT `DISPLAY_TIME_ZONE`. For a client in Québec — the whole MVP
 * market — the two are the same zone and the value is right. For a client typing
 * from another zone, « 14:00 » is read as 14:00 THERE, and would be re-displayed
 * shifted. Hand-written zone arithmetic in an app with no test bench was judged
 * riskier than the debt. Reopening condition: the first request created from a
 * browser outside `America/Toronto`.
 *
 * Only the tender form uses this module. `create-request-form.tsx` still carries
 * its own local copy of `toLocalInputValue` (and a bare `new Date(value)` for the
 * reverse) — debt noted, NOT aggravated: converging it would touch the booking
 * form, which this module's PR does not.
 *
 * No imports, on purpose: it is loaded as-is by `node --test`.
 */

const LOCAL_INPUT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

/**
 * Instant → field value. Built from LOCAL parts on purpose: `toISOString()`
 * would shift the value by the UTC offset and pre-fill the wrong hour.
 */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Field value → epoch milliseconds, or `null` when empty or unreadable.
 *
 * The shape is checked BEFORE parsing: `new Date()` accepts far more than the
 * field produces (a bare date is read as UTC midnight, not local), and a value
 * that is not the field's format must not quietly become some other instant.
 * A date-time without an offset is read as LOCAL time by the spec — which is the
 * D0b behaviour documented above.
 */
export function fromLocalInputValue(value: string): number | null {
  if (!LOCAL_INPUT_RE.test(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
