/**
 * Date and time rendering, pinned to a single display time zone.
 *
 * ⚠️ CE MODULE FORMATE DES INSTANTS, PAS DES JOURS CIVILS. Un `timestamptz`
 * ISO désigne un point sur la ligne du temps, et l'afficher demande un fuseau
 * — d'où DISPLAY_TIME_ZONE. Un `YYYY-MM-DD` nu, lui, est un jour DÉJÀ décidé
 * par l'émetteur : le rendre dans un fuseau à l'ouest d'UTC afficherait la
 * VEILLE. C'est pourquoi `admin/demand-signals/page.tsx` garde son propre
 * formateur épinglé à UTC et n'utilise PAS ce module. Ne pas « harmoniser ».
 */

/**
 * Fuseau d'AFFICHAGE, fixe (D0a). Un rendez-vous appartient au lieu où il se
 * tient, pas à l'écran qui le regarde : client et prestataire voient la même
 * heure murale, celle du service. Fuseau NOMMÉ et jamais un décalage — `-05:00`
 * serait faux la moitié de l'année.
 *
 * Passé EXPLICITEMENT à chaque formateur : sans lui, un Server Component lit le
 * fuseau du processus Node (UTC sur la quasi-totalité des hébergements) et un
 * composant client lit celui du navigateur — deux résultats différents pour la
 * même donnée. Le stockage, lui, reste UTC partout.
 *
 * Le jour où Linkr sort du Québec, ce fuseau se dérive du lieu du service.
 * C'est le seul endroit à changer.
 */
export const DISPLAY_TIME_ZONE = 'America/Toronto';

/**
 * Instantiated ONCE at module level — building an `Intl.DateTimeFormat` is
 * expensive and these run in a loop over every list on the site.
 *
 * ⚠️ TWO date styles, not one, and that is deliberate: the repo already renders
 * `medium` (« 15 sept. 2026 ») on the dashboard and admin console, `long`
 * (« 15 septembre 2026 ») on review and request cards. Collapsing them into a
 * single helper would silently restyle four surfaces — this module moves the
 * time zone, it does not relitigate typography.
 */
const dateTimeFmt = new Intl.DateTimeFormat('fr-CA', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: DISPLAY_TIME_ZONE,
});
const dateFmt = new Intl.DateTimeFormat('fr-CA', {
  dateStyle: 'medium',
  timeZone: DISPLAY_TIME_ZONE,
});
const dateLongFmt = new Intl.DateTimeFormat('fr-CA', {
  dateStyle: 'long',
  timeZone: DISPLAY_TIME_ZONE,
});

/** Shown wherever a timestamp is absent — the repo's em dash, everywhere. */
const ABSENT = '—';

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date + time. `—` when absent; the raw string when unparseable. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ABSENT;
  const d = parse(iso);
  return d ? dateTimeFmt.format(d) : iso;
}

/** Date only, medium (« 15 sept. 2026 »). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ABSENT;
  const d = parse(iso);
  return d ? dateFmt.format(d) : iso;
}

/** Date only, long (« 15 septembre 2026 »). */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return ABSENT;
  const d = parse(iso);
  return d ? dateLongFmt.format(d) : iso;
}

/**
 * The desired window, as one string.
 *
 * Uses `Intl.DateTimeFormat.formatRange`, which collapses the shared parts
 * itself: « 15 sept. 2026, 14 h 00 – 16 h 00 » on one day, both dates spelled
 * out across two. The collapse happens IN THE DISPLAY ZONE — an appointment
 * from 21 h to 23 h Toronto time spans two UTC days and must still read as one
 * evening, which a hand-rolled comparison on UTC parts would get wrong.
 *
 * ⚠️ `formatRange` THROWS a RangeError on an unparseable bound, so both are
 * parsed and checked first. One bound alone degrades to {@link formatDateTime}
 * on the bound that exists; neither gives `—`.
 */
export function formatDateTimeRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string {
  const start = parse(startIso);
  const end = parse(endIso);
  if (start && end) return dateTimeFmt.formatRange(start, end);
  if (start) return dateTimeFmt.format(start);
  if (end) return dateTimeFmt.format(end);
  // Neither parsed: an unparseable string is still worth showing raw, exactly
  // as the single-value helpers above do, rather than claiming « — ».
  return startIso || endIso || ABSENT;
}
