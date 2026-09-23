/**
 * Règles client du formulaire « Publier un appel d'offres » (PR 1b), et — en fin
 * de fichier — celles du devis qu'un prestataire y répond (PR 3).
 *
 * Pure, sans React et SANS AUCUN IMPORT : ce module est chargé tel quel par
 * `node --test --experimental-strip-types` (`tender-rules.test.mjs`), qui ne
 * résout ni l'alias `@/`, ni un import sans extension. Tout ce qui décide si un
 * appel d'offres peut partir vit ici ; le composant ne fait que brancher l'état.
 *
 * Le serveur reste SEUL JUGE (PR 1a, `service-requests.service.ts`). Ces règles
 * en sont le MIROIR, avec les MÊMES comparateurs, pour que le navigateur dise en
 * français, au champ, ce que l'API ne saurait dire que par un 400 générique —
 * le mappage d'erreurs se fait par code HTTP seul (verrou 3.12b), donc un refus
 * serveur ne peut jamais nommer le champ fautif.
 *
 * Tous les instants sont des millisecondes epoch. La conversion depuis le champ
 * `datetime-local` est faite par l'appelant (`lib/dates/local-input.ts`).
 */

// ---------------------------------------------------------------------------
// R1 — MIROIRS de `apps/api/src/modules/service-requests/constants.ts`.
// ⚠️ Comparés par `scripts/check-mirrored-constants.mjs` (garde CI
// `mirror-guard.yml`) : les trois doivent rester des littéraux numériques
// déclarés UNE seule fois ici. Durcir le serveur seul ferait offrir par le
// formulaire une date limite que l'API refuse, sans pouvoir dire pourquoi.
// ---------------------------------------------------------------------------

/** Délai minimum entre la publication et la date limite des devis. INCLUSIF. */
export const MIN_QUOTES_DEADLINE_HOURS = 48;
/** Délai maximum, en durée FIXE (30 × 24 h), jamais en jours civils. INCLUSIF. */
export const MAX_QUOTES_DEADLINE_DAYS = 30;
/** Marge minimale entre la date limite et le début souhaité. INCLUSIF. */
export const QUOTES_DEADLINE_BUFFER_HOURS = 24;

// ---------------------------------------------------------------------------
// R4 — budget. Pas dans la table des miroirs : la valeur API est écrite avec
// des séparateurs (`9_999_999_999.99`), que la garde textuelle ne lit pas.
// C'est la capacité de `numeric(12, 2)`, pas un plafond métier.
// ---------------------------------------------------------------------------

export const MAX_ESTIMATED_AMOUNT = 9999999999.99;
/** La devise n'est pas un choix : lancement québécois. */
export const TENDER_CURRENCY = 'CAD';

/**
 * Marge ajoutée aux options RELATIVES au moment de la soumission.
 *
 * L'option « 48 heures » vise exactement le plancher du serveur. Or le serveur
 * compare à SON « maintenant », mesuré après le trajet de la requête : sans
 * marge, l'option la plus demandée serait refusée d'une poignée de
 * millisecondes. Quinze minutes, puis arrondi au quart d'heure SUIVANT, pour
 * qu'une date limite se lise « 14 h 15 » et jamais « 14 h 07 ».
 *
 * ⚠️ Ne s'applique PAS à la date personnalisée : l'utilisateur l'a choisie, elle
 * est validée telle quelle.
 */
export const DEADLINE_SUBMIT_MARGIN_MINUTES = 15;

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const QUARTER_HOUR_MS = 15 * MS_PER_MINUTE;

/** Plus tôt qu'un début de fenêtre puisse être pour laisser place à une date limite. */
export const MIN_WINDOW_START_HOURS = MIN_QUOTES_DEADLINE_HOURS + QUOTES_DEADLINE_BUFFER_HOURS;

// ---------------------------------------------------------------------------
// Date limite des devis
// ---------------------------------------------------------------------------

export type RelativeDeadline = '48h' | '7d' | '14d';
export type DeadlineChoice = RelativeDeadline | 'custom';

export const RELATIVE_DEADLINES: ReadonlyArray<{
  value: RelativeDeadline;
  label: string;
  hours: number;
}> = [
  { value: '48h', label: '48 heures', hours: MIN_QUOTES_DEADLINE_HOURS },
  { value: '7d', label: '7 jours (recommandé)', hours: 7 * 24 },
  { value: '14d', label: '14 jours', hours: 14 * 24 },
];

/** Arrondi au quart d'heure suivant (une valeur déjà sur un quart d'heure est gardée). */
export function ceilToQuarterHour(ms: number): number {
  return Math.ceil(ms / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
}

/**
 * Date limite d'une option relative, calculée à `nowMs`.
 *
 * ⚠️ `nowMs` doit être l'instant de la SOUMISSION, pas celui du rendu : un
 * formulaire resté ouvert une heure enverrait sinon une date limite déjà
 * entamée d'une heure — et l'option « 48 heures » tomberait sous le plancher.
 */
export function relativeDeadlineMs(choice: RelativeDeadline, nowMs: number): number {
  const option = RELATIVE_DEADLINES.find((o) => o.value === choice);
  if (!option) throw new Error(`Unknown relative deadline: ${String(choice)}`);
  return ceilToQuarterHour(
    nowMs + option.hours * MS_PER_HOUR + DEADLINE_SUBMIT_MARGIN_MINUTES * MS_PER_MINUTE,
  );
}

export type DeadlineViolation = 'too-soon' | 'too-far' | 'too-close-to-start';

/**
 * R1, avec les comparateurs du service (bornes INCLUSIVES : la valeur exacte
 * passe). `windowStartMs` à `null` = dates flexibles, pas de contrainte de sas.
 */
export function checkQuotesDeadline(
  deadlineMs: number,
  nowMs: number,
  windowStartMs: number | null,
): DeadlineViolation | null {
  if (deadlineMs < nowMs + MIN_QUOTES_DEADLINE_HOURS * MS_PER_HOUR) return 'too-soon';
  if (deadlineMs > nowMs + MAX_QUOTES_DEADLINE_DAYS * 24 * MS_PER_HOUR) return 'too-far';
  if (
    windowStartMs !== null &&
    deadlineMs > windowStartMs - QUOTES_DEADLINE_BUFFER_HOURS * MS_PER_HOUR
  ) {
    return 'too-close-to-start';
  }
  return null;
}

/** Une option relative est offerte ssi la date qu'elle produirait passe R1. */
export function isRelativeDeadlineAvailable(
  choice: RelativeDeadline,
  nowMs: number,
  windowStartMs: number | null,
): boolean {
  return checkQuotesDeadline(relativeDeadlineMs(choice, nowMs), nowMs, windowStartMs) === null;
}

/**
 * Existe-t-il AU MOINS une date limite valide ? Faux seulement quand le début
 * de fenêtre est à moins de 72 h : le plancher (48 h) et le sas (24 h) ne
 * laissent alors aucune place.
 */
export function hasAnyValidDeadline(nowMs: number, windowStartMs: number | null): boolean {
  if (windowStartMs === null) return true;
  return (
    windowStartMs - QUOTES_DEADLINE_BUFFER_HOURS * MS_PER_HOUR >=
    nowMs + MIN_QUOTES_DEADLINE_HOURS * MS_PER_HOUR
  );
}

export type DefaultDeadline =
  | { choice: '7d' }
  | { choice: 'custom'; deadlineMs: number }
  | { choice: null };

/**
 * Défaut : min(7 jours, début de fenêtre − 24 h).
 *
 * Quand la fenêtre force une date plus proche que 7 jours, cette date n'est
 * aucune des options relatives : le défaut devient une date PERSONNALISÉE
 * préremplie à « début − 24 h » (la borne est inclusive, elle passe). Quand
 * même celle-ci tombe sous le plancher, il n'y a pas de défaut du tout — et le
 * formulaire dit pourquoi (`hasAnyValidDeadline`).
 */
export function defaultDeadline(nowMs: number, windowStartMs: number | null): DefaultDeadline {
  if (isRelativeDeadlineAvailable('7d', nowMs, windowStartMs)) return { choice: '7d' };
  if (windowStartMs !== null) {
    const deadlineMs = windowStartMs - QUOTES_DEADLINE_BUFFER_HOURS * MS_PER_HOUR;
    if (checkQuotesDeadline(deadlineMs, nowMs, windowStartMs) === null) {
      return { choice: 'custom', deadlineMs };
    }
  }
  return { choice: null };
}

// ---------------------------------------------------------------------------
// R2 — fenêtre de démarrage
// ---------------------------------------------------------------------------

export type WindowViolation =
  | 'missing-start'
  | 'missing-end'
  | 'end-not-after-start'
  | 'start-too-soon';

/**
 * R2 : les deux bornes ensemble, fin STRICTEMENT après le début. Et PAS de
 * plafond de largeur : le plafond de 24 h de la réservation directe existe à
 * cause de D8 (l'acceptation retient le début), qui ne vaut pas pour un appel
 * d'offres. Aucun validateur de la réservation directe n'est hérité ici.
 *
 * `start-too-soon` n'est pas une règle du serveur sur la fenêtre : c'est la
 * CONSÉQUENCE de R1 (plancher 48 h + sas 24 h), signalée au champ début parce
 * que c'est là qu'elle se corrige. ⚠️ Testée AVANT la fin : un début trop
 * proche est la cause racine — renseigner la fin ne la corrigerait pas, et
 * réclamer d'abord la fin enverrait le client corriger le mauvais champ.
 */
export function checkDesiredWindow(
  startMs: number | null,
  endMs: number | null,
  nowMs: number,
): WindowViolation | null {
  if (startMs === null) return 'missing-start';
  if (!hasAnyValidDeadline(nowMs, startMs)) return 'start-too-soon';
  if (endMs === null) return 'missing-end';
  if (endMs <= startMs) return 'end-not-after-start';
  return null;
}

// ---------------------------------------------------------------------------
// R4 — budget indicatif
// ---------------------------------------------------------------------------

export type BudgetParse =
  | { kind: 'empty' }
  | { kind: 'ok'; amount: number }
  | { kind: 'invalid'; reason: 'format' | 'not-positive' | 'too-large' };

/**
 * Facultatif. Vide → aucun budget (ni montant ni devise : ils voyagent en
 * paire, `chk_service_requests_estimated_pair`). Accepte la virgule comme la
 * virgule décimale québécoise, et les espaces (y compris insécables) comme
 * séparateurs de milliers. Deux décimales au plus, comme `maxDecimalPlaces: 2`
 * du DTO — la colonne `numeric(12,2)` ARRONDIRAIT une troisième sans la refuser.
 */
export function parseBudget(raw: string): BudgetParse {
  const compact = raw.replace(/[\s  ]/g, '');
  if (compact === '') return { kind: 'empty' };
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(compact)) return { kind: 'invalid', reason: 'format' };
  const amount = Number(compact.replace(',', '.'));
  if (!Number.isFinite(amount)) return { kind: 'invalid', reason: 'format' };
  if (amount <= 0) return { kind: 'invalid', reason: 'not-positive' };
  if (amount > MAX_ESTIMATED_AMOUNT) return { kind: 'invalid', reason: 'too-large' };
  return { kind: 'ok', amount };
}

// ---------------------------------------------------------------------------
// Assemblage — la décision « peut-on publier ? »
// ---------------------------------------------------------------------------

export const TITLE_MAX = 200;
export const ADDRESS_MAX = 500;

export type TenderField =
  | 'category'
  | 'title'
  | 'description'
  | 'address'
  | 'windowStart'
  | 'windowEnd'
  | 'deadline'
  | 'budget';

/** Ordre du formulaire à l'écran : le focus va au premier champ fautif. */
export const FIELD_ORDER: readonly TenderField[] = [
  'category',
  'title',
  'description',
  'address',
  'windowStart',
  'windowEnd',
  'deadline',
  'budget',
];

export type TenderErrors = Partial<Record<TenderField, string>>;

export interface TenderDraft {
  categoryId: string;
  title: string;
  description: string;
  address: string;
  /**
   * La coordonnée d'un candidat géocodé que l'utilisateur a VU et CHOISI —
   * `null` dans tout autre cas. Il n'existe AUCUNE autre source : ni
   * coordonnées d'URL, ni zone de recherche, ni point par défaut.
   */
  location: { lat: number; lng: number } | null;
  hasWindow: boolean;
  windowStartMs: number | null;
  windowEndMs: number | null;
  deadlineChoice: DeadlineChoice | null;
  /** Lu seulement quand `deadlineChoice === 'custom'`. */
  customDeadlineMs: number | null;
  budget: string;
}

/** Le corps publié. `serviceLocationPrecision` est un LITTÉRAL, jamais un paramètre. */
export interface TenderBody {
  requestType: 'PROJECT_TENDER';
  serviceCategoryId: string;
  title: string;
  description: string;
  serviceAddress: string;
  serviceLocation: { type: 'Point'; coordinates: [number, number] };
  serviceLocationPrecision: 'GEOCODED';
  quotesDeadlineUtc: string;
  desiredStartAtUtc?: string;
  desiredEndAtUtc?: string;
  estimatedAmount?: number;
  estimatedCurrency?: string;
}

export type TenderAssembly =
  | { kind: 'invalid'; errors: TenderErrors }
  /** Tous les champs passent, mais aucune adresse n'a été choisie : géocoder. */
  | { kind: 'needs-location' }
  | { kind: 'ready'; body: TenderBody };

const DEADLINE_MESSAGES: Record<DeadlineViolation, string> = {
  'too-soon': `La date limite doit être au moins ${MIN_QUOTES_DEADLINE_HOURS} heures après maintenant.`,
  'too-far': `La date limite ne peut pas dépasser ${MAX_QUOTES_DEADLINE_DAYS} jours.`,
  'too-close-to-start': `La date limite doit précéder le début des travaux d’au moins ${QUOTES_DEADLINE_BUFFER_HOURS} heures.`,
};

const WINDOW_MESSAGES: Record<WindowViolation, string> = {
  'missing-start': 'Indiquez le début de la fenêtre de démarrage.',
  'missing-end': 'Indiquez la fin de la fenêtre de démarrage.',
  'end-not-after-start': 'La fin de la fenêtre doit être postérieure à son début.',
  'start-too-soon': startTooSoonMessage(),
};

/**
 * Pourquoi un début à moins de 72 h est refusé — la phrase que le formulaire
 * affiche aussi quand toutes les dates limites sont grisées.
 */
export function startTooSoonMessage(): string {
  return `Le début doit être au moins ${MIN_WINDOW_START_HOURS} heures après maintenant : il faut ${MIN_QUOTES_DEADLINE_HOURS} heures pour recevoir des devis, puis ${QUOTES_DEADLINE_BUFFER_HOURS} heures pour en choisir un avant le début des travaux.`;
}

const BUDGET_MESSAGES: Record<'format' | 'not-positive' | 'too-large', string> = {
  format: 'Indiquez un montant en dollars, par exemple 1500 ou 1500,50.',
  'not-positive': 'Le budget doit être supérieur à 0 $.',
  'too-large': 'Ce montant est trop élevé.',
};

/**
 * La seule porte de sortie vers le POST. `nowMs` = instant de la SOUMISSION.
 *
 * Ordre délibéré : TOUS les champs sont vérifiés AVANT de constater l'absence
 * d'adresse choisie. Sinon l'utilisateur choisirait une adresse dans la liste
 * de candidats, puis apprendrait seulement ensuite que la date est refusée —
 * la seconde moitié d'une soumission rejetée pour la première.
 *
 * ⚠️ Aucun chemin ne produit `ready` sans `location` : un appel d'offres n'a PAS
 * d'échappatoire. Il n'y a ni « Envoyer quand même », ni repli `UNKNOWN`, ni
 * point par défaut. La coordonnée décide quels prestataires reçoivent l'appel
 * d'offres (diffusion géographique) : un point faux l'enverrait aux mauvais
 * prestataires, sans rien à l'écran pour le révéler.
 */
export function assembleTender(draft: TenderDraft, nowMs: number): TenderAssembly {
  const errors: TenderErrors = {};

  if (!draft.categoryId) errors.category = 'Veuillez choisir un métier.';

  const title = draft.title.trim();
  if (!title) errors.title = 'Veuillez indiquer un titre.';
  else if (title.length > TITLE_MAX) {
    errors.title = `Le titre ne peut pas dépasser ${TITLE_MAX} caractères.`;
  }

  const description = draft.description.trim();
  if (!description) errors.description = 'Veuillez décrire les travaux.';

  const address = draft.address.trim();
  if (!address) errors.address = 'Veuillez indiquer l’adresse des travaux.';
  else if (address.length > ADDRESS_MAX) {
    errors.address = `L’adresse ne peut pas dépasser ${ADDRESS_MAX} caractères.`;
  }

  // R2 — fenêtre (facultative). Une fenêtre invalide ne sert PAS à juger la
  // date limite : son début n'est pas fiable, et le vrai problème est déjà
  // signalé au bon champ.
  let windowStartForDeadline: number | null = null;
  if (draft.hasWindow) {
    const violation = checkDesiredWindow(draft.windowStartMs, draft.windowEndMs, nowMs);
    if (violation === null) {
      windowStartForDeadline = draft.windowStartMs;
    } else if (violation === 'missing-end' || violation === 'end-not-after-start') {
      errors.windowEnd = WINDOW_MESSAGES[violation];
    } else {
      errors.windowStart = WINDOW_MESSAGES[violation];
    }
  }

  // R1 — date limite, recalculée ICI pour une option relative. Pas jugée du
  // tout quand le début de fenêtre est en faute : c'est lui la cause (souvent,
  // il ne laisse AUCUNE date limite possible), et deux erreurs pour une seule
  // cause enverraient le client corriger le mauvais champ.
  let deadlineMs: number | null = null;
  if (errors.windowStart === undefined) {
    if (draft.deadlineChoice === null) {
      errors.deadline = 'Veuillez choisir une date limite pour les devis.';
    } else if (draft.deadlineChoice === 'custom') {
      if (draft.customDeadlineMs === null) {
        errors.deadline = 'Veuillez indiquer la date limite des devis.';
      } else {
        deadlineMs = draft.customDeadlineMs;
      }
    } else {
      deadlineMs = relativeDeadlineMs(draft.deadlineChoice, nowMs);
    }
    if (deadlineMs !== null) {
      const violation = checkQuotesDeadline(deadlineMs, nowMs, windowStartForDeadline);
      if (violation !== null) errors.deadline = DEADLINE_MESSAGES[violation];
    }
  }

  // R4 — budget.
  const budget = parseBudget(draft.budget);
  if (budget.kind === 'invalid') errors.budget = BUDGET_MESSAGES[budget.reason];

  if (Object.keys(errors).length > 0) return { kind: 'invalid', errors };
  if (draft.location === null) return { kind: 'needs-location' };
  // Inatteignable (une erreur aurait été levée) — resserre le type pour la suite.
  if (deadlineMs === null) return { kind: 'invalid', errors: { deadline: 'Veuillez choisir une date limite pour les devis.' } };

  const body: TenderBody = {
    requestType: 'PROJECT_TENDER',
    serviceCategoryId: draft.categoryId,
    title,
    description,
    serviceAddress: address,
    // ⚠️ GeoJSON : LONGITUDE D'ABORD. Au Québec, lng ≈ -73 (négatif), lat ≈ 45.
    serviceLocation: { type: 'Point', coordinates: [draft.location.lng, draft.location.lat] },
    serviceLocationPrecision: 'GEOCODED',
    quotesDeadlineUtc: new Date(deadlineMs).toISOString(),
  };
  if (windowStartForDeadline !== null && draft.windowEndMs !== null) {
    body.desiredStartAtUtc = new Date(windowStartForDeadline).toISOString();
    body.desiredEndAtUtc = new Date(draft.windowEndMs).toISOString();
  }
  if (budget.kind === 'ok') {
    body.estimatedAmount = budget.amount;
    body.estimatedCurrency = TENDER_CURRENCY;
  }
  return { kind: 'ready', body };
}

// ===========================================================================
// PR 3 — RÉPONDRE à un appel d'offres (devis du prestataire)
//
// Même contrat que tout ce qui précède : pur, sans import, testé sous
// `node --test` (`tender-quote.test.mjs`). Le composant ne fait que brancher
// l'état ; les conversions (heures → minutes, date → midi UTC, validité) et la
// décision « peut-on envoyer ? » vivent ICI.
// ===========================================================================

/**
 * R7 — MIROIR de `apps/api/src/modules/service-requests/constants.ts`.
 * ⚠️ Comparé par `scripts/check-mirrored-constants.mjs`.
 *
 * La date limite ferme la RÉCEPTION des devis, pas la SÉLECTION : un tender qui
 * a reçu un devis reste `OPEN` jusqu'à sept jours de plus pour que le client
 * choisisse. Un devis doit donc rester valide jusqu'à la FIN de cette période —
 * s'il expirait avant, le client ne pourrait plus retenir l'offre qu'il est en
 * train de comparer. Si la valeur divergeait de l'API, la validité calculée ici
 * ne couvrirait plus (ou dépasserait) la fenêtre réelle, sans aucun symptôme.
 */
export const TENDER_SELECTION_WINDOW_DAYS = 7;

const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Capacité de la colonne `quotes.estimated_duration_minutes` (`integer`, int4).
 * Pas un plafond métier : juste de quoi transformer un dépassement en message
 * au champ plutôt qu'en 500 au cast SQL.
 */
export const MAX_DURATION_MINUTES = 2147483647;

/**
 * `validUntilUtc` n'est PAS un champ du formulaire : il est calculé À LA
 * SOUMISSION = date limite des devis + {@link TENDER_SELECTION_WINDOW_DAYS},
 * c'est-à-dire la fin exacte de la période de sélection (R7). `null` sur une
 * date illisible — ne jamais fabriquer un instant.
 */
export function quoteValidUntil(quotesDeadlineUtc: string): string | null {
  const deadlineMs = Date.parse(quotesDeadlineUtc);
  if (!Number.isFinite(deadlineMs)) return null;
  return new Date(deadlineMs + TENDER_SELECTION_WINDOW_DAYS * MS_PER_DAY).toISOString();
}

export type DurationViolation = 'empty' | 'format' | 'not-positive' | 'step' | 'too-large';

export type DurationParse =
  | { kind: 'ok'; minutes: number }
  | { kind: 'invalid'; reason: DurationViolation };

/**
 * Durée estimée saisie en HEURES, par pas d'une demi-heure (virgule québécoise
 * acceptée) → minutes ENTIÈRES strictement positives, comme `@IsInt()
 * @IsPositive()` du DTO. « 0,5 » → 30 ; « 0 » et le négatif sont refusés.
 */
export function parseDurationHours(raw: string): DurationParse {
  const compact = raw.replace(/[\s  ]/g, '');
  if (compact === '') return { kind: 'invalid', reason: 'empty' };
  // Aucun signe accepté : « -1 » est un format invalide, jamais un nombre
  // négatif qu'on corrigerait en silence.
  if (!/^\d+(?:[.,]\d+)?$/.test(compact)) return { kind: 'invalid', reason: 'format' };
  const hours = Number(compact.replace(',', '.'));
  if (!Number.isFinite(hours)) return { kind: 'invalid', reason: 'format' };
  if (hours <= 0) return { kind: 'invalid', reason: 'not-positive' };
  // Pas d'une demi-heure : le double d'une durée valide est un entier.
  if (!Number.isInteger(hours * 2)) return { kind: 'invalid', reason: 'step' };
  const minutes = hours * 60;
  if (minutes > MAX_DURATION_MINUTES) return { kind: 'invalid', reason: 'too-large' };
  return { kind: 'ok', minutes };
}

const DATE_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Valeur d'un `<input type="date">` (`YYYY-MM-DD`) → MIDI UTC ce jour-là.
 *
 * Midi et non minuit : un jour civil ne porte pas d'heure, et minuit UTC se
 * relit LA VEILLE à Toronto (même famille que le contrefactuel « 02:30Z » du
 * §13.1 nº 17). Midi UTC tombe le même jour civil sur tout le continent.
 *
 * `null` si le champ est vide. Une valeur qui n'a pas la forme du champ, ou une
 * date impossible (« 2026-02-30 »), vaut `'invalid'` plutôt que de devenir en
 * silence un autre jour.
 */
export function proposedStartToUtc(value: string): string | null | 'invalid' {
  if (value === '') return null;
  const m = DATE_INPUT_RE.exec(value);
  if (!m) return 'invalid';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return 'invalid';
  }
  return d.toISOString();
}

/**
 * Le compteur de l'onglet « Appels d'offres » : ce qui reste À TRAITER, c'est-à-
 * dire tout tender sur lequel le prestataire n'a PAS de devis vivant. Un devis
 * `SUBMITTED` est traité (il attend le client) ; `null`, `WITHDRAWN` et
 * `EXPIRED` laissent la porte ouverte et comptent.
 */
export function tendersToHandleCount(
  items: ReadonlyArray<{ myQuoteStatus: string | null }>,
): number {
  return items.filter((item) => item.myQuoteStatus !== 'SUBMITTED').length;
}

export type QuoteField = 'amount' | 'duration' | 'description' | 'proposedStart';

/** L'ordre des champs à l'écran — le focus va au premier en faute. */
export const QUOTE_FIELD_ORDER: readonly QuoteField[] = [
  'amount',
  'duration',
  'description',
  'proposedStart',
];

export type QuoteErrors = Partial<Record<QuoteField, string>>;

export interface QuoteDraft {
  amount: string;
  durationHours: string;
  description: string;
  /** Valeur brute du `<input type="date">`, `''` si vide. */
  proposedStartDate: string;
}

/**
 * Le corps envoyé au relais BFF. ⚠️ SANS devise : `CAD` est FIGÉE côté serveur,
 * dans le relais (`app/api/service-requests/[id]/quotes/route.ts`) — un seul
 * endroit, jamais pilotable depuis le navigateur.
 */
export interface QuoteBody {
  amount: number;
  estimatedDurationMinutes: number;
  description: string;
  proposedStartAtUtc?: string;
  validUntilUtc: string;
}

export type QuoteAssembly =
  | { kind: 'invalid'; errors: QuoteErrors }
  /** La date limite du tender est illisible : aucune validité ne peut être calculée. */
  | { kind: 'no-deadline' }
  | { kind: 'ready'; body: QuoteBody };

const AMOUNT_MESSAGES: Record<'format' | 'not-positive' | 'too-large', string> = {
  format: 'Indiquez un montant en dollars, par exemple 850 ou 850,50.',
  'not-positive': 'Le montant doit être supérieur à 0 $.',
  'too-large': 'Ce montant est trop élevé.',
};

const DURATION_MESSAGES: Record<DurationViolation, string> = {
  empty: 'Indiquez la durée estimée des travaux.',
  format: 'Indiquez une durée en heures, par exemple 3 ou 1,5.',
  'not-positive': 'La durée doit être supérieure à 0 heure.',
  step: 'Indiquez la durée par demi-heure, par exemple 1,5 ou 2.',
  'too-large': 'Cette durée est trop longue.',
};

/**
 * La seule porte vers le POST de devis. Aucune règle sur la date de début
 * proposée au-delà de sa FORME : l'API n'en a aucune, et en inventer une ici
 * ferait refuser par le navigateur ce que le serveur accepte (le `min` du champ
 * n'est qu'une courtoisie côté navigateur).
 *
 * Le montant réutilise {@link parseBudget} : même capacité `numeric(12, 2)`,
 * même virgule québécoise, deux décimales au plus (`maxDecimalPlaces: 2`) — mais
 * ici un champ vide est une ERREUR, le montant d'un devis n'est pas facultatif.
 */
export function assembleQuote(draft: QuoteDraft, quotesDeadlineUtc: string): QuoteAssembly {
  const errors: QuoteErrors = {};

  const amount = parseBudget(draft.amount);
  if (amount.kind === 'empty') errors.amount = 'Indiquez le montant de votre devis.';
  else if (amount.kind === 'invalid') errors.amount = AMOUNT_MESSAGES[amount.reason];

  const duration = parseDurationHours(draft.durationHours);
  if (duration.kind === 'invalid') errors.duration = DURATION_MESSAGES[duration.reason];

  const description = draft.description.trim();
  if (!description) errors.description = 'Décrivez ce que comprend votre devis.';

  const proposedStart = proposedStartToUtc(draft.proposedStartDate);
  if (proposedStart === 'invalid') errors.proposedStart = 'Indiquez une date valide.';

  if (amount.kind !== 'ok' || duration.kind !== 'ok' || proposedStart === 'invalid' || !description) {
    return { kind: 'invalid', errors };
  }

  const validUntilUtc = quoteValidUntil(quotesDeadlineUtc);
  if (validUntilUtc === null) return { kind: 'no-deadline' };

  const body: QuoteBody = {
    amount: amount.amount,
    estimatedDurationMinutes: duration.minutes,
    description,
    validUntilUtc,
  };
  if (proposedStart !== null) body.proposedStartAtUtc = proposedStart;
  return { kind: 'ready', body };
}
