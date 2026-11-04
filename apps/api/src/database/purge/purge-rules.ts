/**
 * Purge des comptes e2e (mode A) — règles pures, sans base ni réseau.
 *
 * Tout ce qui décide QUI est visé et QUELLES tables peuvent être modifiées vit
 * ici, en constantes, pour être testé par jest sans base de données.
 *
 * ⚠️ Liste e2e codée dans le script (décision D12) :
 *   - deux comptes FIXES, gardés en entier (D3) : seules leurs transactions et
 *     leurs cartes sont supprimées ;
 *   - les anciens comptes « e2e+…@gmail.com » (format de newAccount() au commit
 *     ce4afa3) ET prénom « e2e », supprimés en entier.
 * Aucune autre adresse ne peut être visée. Jamais de correspondance partielle
 * de type motif SQL : égalité exacte, ou expression régulière ANCRÉE.
 *
 * ⚠️ L'adresse est comparée BRUTE : jamais de passage en minuscules (ni en SQL
 * ni en JS), jamais de trim.
 * L'inscription ne normalise pas l'adresse et l'index unique porte sur
 * l'adresse brute : « E2E-Client@LinkrApp.com » est un AUTRE compte, que
 * n'importe qui peut créer (aucune vérification de courriel). Normaliser la
 * casse ferait de ce compte un deuxième « compte fixe ». Même raison pour le
 * signe Kelvin (U+212A), que la mise en minuscules de Postgres change en « k ».
 */
import { createHash } from 'node:crypto';
import { isAbsolute, posix } from 'node:path';

/** Comptes e2e fixes (règles Cloudflare Email Routing). Gardés en entier. */
export const FIXED_E2E_EMAILS: readonly string[] = [
  'e2e-prestataire@linkrapp.com',
  'e2e-client@linkrapp.com',
];

/**
 * Anciens comptes e2e : `e2e+${prestataire|client}-${aaaammjj}-${8 hex}@gmail.com`,
 * vérifié dans e2e/lib/accounts.ts au commit ce4afa3 (newAccount()).
 */
export const LEGACY_E2E_EMAIL_PATTERN =
  /^e2e\+(prestataire|client)-[0-9]{8}-[0-9a-f]{8}@gmail\.com$/;

/**
 * Même motif, pour l'opérateur `~` de Postgres (regex POSIX). Il ne sert qu'à
 * réduire les candidats lus ; la décision finale reste `classifyAccount`, qui
 * applique la regex JS ci-dessus. Les deux sont tenus ensemble par un test.
 */
export const LEGACY_E2E_EMAIL_SQL_PATTERN =
  '^e2e\\+(prestataire|client)-[0-9]{8}-[0-9a-f]{8}@gmail\\.com$';

/**
 * Prénom posé par e2e/lib/flows.ts sur tout compte e2e (inscription). Exigé
 * pour TOUS les comptes visés, fixes compris.
 */
export const LEGACY_E2E_FIRST_NAME = 'e2e';

/**
 * Tables modifiables, dans l'ordre sûr de suppression (enfants d'abord, §1 du
 * rapport de phase 1). C'est la LISTE FERMÉE : aucune autre table ne reçoit
 * d'ordre d'écriture, et le rôle linkr_purge n'a le droit d'écrire que là.
 *
 * `organization_memberships` y figure pour deux raisons : le contrôle de
 * fermeture la LIT, et elle doit être VERROUILLÉE (`LOCK TABLE … SHARE ROW
 * EXCLUSIVE`, qui exige le droit DELETE) : sans ce verrou, une adhésion insérée
 * pendant la purge serait supprimée en silence par la cascade depuis `users`.
 * Elle ne reçoit jamais d'ordre DELETE du script : une adhésion d'un compte
 * e2e est une donnée d'organisation, la purge s'arrête si elle en trouve une.
 */
export const DELETE_ORDER = [
  'refunds',
  'payments',
  'reviews',
  'notifications',
  'quotes',
  'service_request_attachments',
  'service_request_assignments',
  'service_requests',
  'payment_methods',
  'portfolio_items',
  'verification_documents',
  'professional_services',
  'professional_service_categories',
  'professional_service_zones',
  'stripe_connect_accounts',
  'service_providers',
  'organization_memberships',
  'password_reset_tokens',
  'user_auth_providers',
  'users',
] as const;

export type ModifiableTable = (typeof DELETE_ORDER)[number];

/** Catalogue de référence, schéma, migrations : lus, jamais écrits. */
export const PROTECTED_TABLES = [
  'service_categories',
  'service_items',
  'regulatory_requirements',
  'typeorm_migrations',
  'spatial_ref_sys',
] as const;

export type ProtectedTable = (typeof PROTECTED_TABLES)[number];

/** Lève si les deux listes se recoupent. Appelée au démarrage du script. */
export function assertClosedLists(
  modifiable: readonly string[] = DELETE_ORDER,
  protectedTables: readonly string[] = PROTECTED_TABLES,
): void {
  const overlap = modifiable.filter((t) => protectedTables.includes(t));
  if (overlap.length > 0) {
    throw new PurgeRefusal(`table(s) à la fois modifiable(s) et protégée(s) : ${overlap.join(', ')}`);
  }
  if (new Set(modifiable).size !== modifiable.length) {
    throw new PurgeRefusal('liste des tables modifiables en double');
  }
}

/** Garde avant toute interpolation d'un nom de table dans du SQL. */
export function assertModifiable(table: string): asserts table is ModifiableTable {
  if (!(DELETE_ORDER as readonly string[]).includes(table)) {
    throw new PurgeRefusal(`table hors de la liste fermée : ${table}`);
  }
}

export function assertProtected(table: string): asserts table is ProtectedTable {
  if (!(PROTECTED_TABLES as readonly string[]).includes(table)) {
    throw new PurgeRefusal(`table protégée inconnue : ${table}`);
  }
}

/** Refus net : la purge s'arrête sans rien écrire. */
export class PurgeRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurgeRefusal';
  }
}

export type AccountMode = 'TRANSACTIONS_ONLY' | 'FULL';

export interface CandidateAccount {
  id: string;
  email: string;
  firstName: string;
  systemRole: string;
  deletedAtUtc: Date | string | null;
}

export interface RetainedAccount {
  id: string;
  mode: AccountMode;
  /** Libellé sans adresse courriel (§13 nº 19), pour l'affichage. */
  label: string;
  systemRole: string;
}

export type Classification =
  | { kind: 'retained'; account: RetainedAccount }
  | { kind: 'ignored'; id: string; reason: string };

/**
 * Décide si un candidat lu en base est visé, et dans quel mode.
 * Un compte fixe supprimé en douceur n'est PAS visé (hors périmètre, signalé).
 * Un ancien compte n'est visé que si la regex ancrée ET le prénom concordent.
 */
export function classifyAccount(row: CandidateAccount): Classification {
  const email = row.email; // BRUTE : voir l'en-tête du fichier
  if (FIXED_E2E_EMAILS.includes(email)) {
    if (row.firstName !== LEGACY_E2E_FIRST_NAME) {
      return { kind: 'ignored', id: row.id, reason: 'adresse fixe mais prénom différent de « e2e », non touché' };
    }
    if (row.deletedAtUtc != null) {
      return { kind: 'ignored', id: row.id, reason: 'compte fixe déjà supprimé en douceur, non touché' };
    }
    return {
      kind: 'retained',
      account: {
        id: row.id,
        mode: 'TRANSACTIONS_ONLY',
        label: `fixe ${email.split('@')[0]}`,
        systemRole: row.systemRole,
      },
    };
  }
  const match = LEGACY_E2E_EMAIL_PATTERN.exec(email);
  if (match) {
    if (row.firstName !== LEGACY_E2E_FIRST_NAME) {
      return { kind: 'ignored', id: row.id, reason: 'adresse au format e2e mais prénom différent, non touché' };
    }
    const [, role, rest] = /^e2e\+(prestataire|client)-([0-9]{8}-[0-9a-f]{8})@/.exec(email) ?? [];
    return {
      kind: 'retained',
      account: { id: row.id, mode: 'FULL', label: `ancien ${role} ${rest}`, systemRole: row.systemRole },
    };
  }
  return { kind: 'ignored', id: row.id, reason: 'adresse hors liste e2e' };
}

/**
 * Une adresse fixe doit désigner UNE seule ligne (supprimée en douceur
 * comprise). Plus d'une : refus net, l'opérateur décide.
 */
export function assertSingleFixedRow(emails: readonly string[]): void {
  for (const fixed of FIXED_E2E_EMAILS) {
    const n = emails.filter((e) => e === fixed).length;
    if (n > 1) {
      throw new PurgeRefusal(`l'adresse fixe « ${fixed.split('@')[0]} » correspond à ${n} lignes : refus`);
    }
  }
}

/** D4 : jamais de compte ADMIN supprimé ni touché. */
export function assertNoAdmin(accounts: readonly RetainedAccount[]): void {
  const admins = accounts.filter((a) => a.systemRole === 'ADMIN');
  if (admins.length > 0) {
    throw new PurgeRefusal(
      `compte(s) ADMIN dans la liste e2e, refus : ${admins.map((a) => a.id).join(', ')}`,
    );
  }
}

/**
 * Empreinte du plan : SHA-256 de la liste triée des comptes visés (id + mode)
 * et des identifiants visés, table par table. Si la base change entre la
 * simulation et l'exécution, l'empreinte change et l'exécution s'arrête.
 */
export function planFingerprint(
  accounts: readonly Pick<RetainedAccount, 'id' | 'mode'>[],
  rows: Partial<Record<ModifiableTable, readonly string[]>>,
): string {
  const lines: string[] = [];
  for (const a of [...accounts].sort((x, y) => x.id.localeCompare(y.id))) {
    lines.push(`account:${a.id}:${a.mode}`);
  }
  for (const table of DELETE_ORDER) {
    for (const id of [...(rows[table] ?? [])].sort()) lines.push(`${table}:${id}`);
  }
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 12);
}

/**
 * Phrase que l'opérateur tape à la main avant l'exécution. Le nombre est celui
 * des comptes supprimés EN ENTIER ; les comptes fixes gardés sont affichés à
 * part. L'empreinte, elle, couvre tous les comptes visés.
 */
export function confirmationPhrase(deletedAccountCount: number, fingerprint: string): string {
  return `PURGER E2E ${deletedAccountCount} COMPTES ${fingerprint}`;
}

/** Comptes supprimés en entier, gardés : la phrase porte le premier nombre. */
export function accountCounts(accounts: readonly Pick<RetainedAccount, 'mode'>[]): { full: number; kept: number } {
  const full = accounts.filter((a) => a.mode === 'FULL').length;
  return { full, kept: accounts.length - full };
}

/** Phrase attendue pour un plan donné. Seule source, pour le CLI et l'exécution. */
export function planPhrase(accounts: readonly Pick<RetainedAccount, 'mode'>[], fingerprint: string): string {
  return confirmationPhrase(accountCounts(accounts).full, fingerprint);
}

/**
 * Une clé de stockage n'est supprimée que si elle reste DANS le volume :
 * relative, sans segment « .. », sous l'un des trois préfixes connus.
 */
const STORAGE_PREFIXES = ['portfolio/', 'verifications/', 'service-request-attachments/'];

export function isSafeStorageKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0 || key.length > 512) return false;
  if (isAbsolute(key) || key.includes('\\') || key.includes('\0')) return false;
  const normalised = posix.normalize(key);
  if (normalised !== key || normalised.startsWith('../') || normalised.split('/').includes('..')) {
    return false;
  }
  return STORAGE_PREFIXES.some((p) => key.startsWith(p));
}

/** Avertissement imprimé à chaque passage qui produit une liste Stripe. */
export const STRIPE_SHARED_SANDBOX_WARNING =
  'Bac à sable Stripe PARTAGÉ avec le développement : NE JAMAIS utiliser « Supprimer toutes les données de test ». Supprimer à la main uniquement ces identifiants.';

/**
 * SQL de création du rôle linkr_purge. Source unique : docs/deploy/purge.md le
 * recopie, et un test vérifie que la doc contient exactement ce texte.
 */
export function roleGrantSql(): string {
  const columnScoped = Object.keys(COLUMN_SCOPED_SELECT);
  const fullSelect = DELETE_ORDER.filter((t) => !columnScoped.includes(t));
  return [
    `CREATE ROLE linkr_purge LOGIN PASSWORD '<mot de passe généré>';`,
    `GRANT SELECT, DELETE ON TABLE ${fullSelect.join(', ')} TO linkr_purge;`,
    `GRANT DELETE ON TABLE ${columnScoped.join(', ')} TO linkr_purge;`,
    ...Object.entries(COLUMN_SCOPED_SELECT).map(
      ([table, cols]) => `GRANT SELECT (${cols.join(', ')}) ON TABLE ${table} TO linkr_purge;`,
    ),
    `GRANT SELECT ON TABLE ${PROTECTED_TABLES.join(', ')} TO linkr_purge;`,
  ].join('\n');
}

/**
 * Tables dont le rôle ne lit QUE certaines colonnes (M2) : jamais un haché de
 * mot de passe ni de jeton. La purge n'a besoin que de `id` et `user_id`.
 */
export const COLUMN_SCOPED_SELECT: Readonly<Record<'user_auth_providers' | 'password_reset_tokens', readonly string[]>> = {
  user_auth_providers: ['id', 'user_id'],
  password_reset_tokens: ['id', 'user_id'],
};

/** Colonnes que le rôle ne doit JAMAIS pouvoir lire (vérifié au démarrage). */
export const FORBIDDEN_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['user_auth_providers', 'password_hash'],
  ['password_reset_tokens', 'token_hash'],
];

/**
 * Témoin de sauvegarde (I4), écrit par deploy/purge.sh dans purge-out APRÈS
 * une sauvegarde réussie : `<horodatage ISO UTC> <nom du fichier de base>`.
 *
 * ⚠️ Garde-fou contre l'ERREUR D'USAGE (oublier la sauvegarde en lançant le
 * conteneur à la main), PAS contre la malveillance : quiconque a un shell sur
 * le VPS peut écrire ce fichier. La barrière reste la règle « aucun agent
 * n'écrit en production » (CLAUDE.md §13 nº 20).
 */
export const BACKUP_WITNESS_FILE = 'backup-witness.txt';
export const BACKUP_WITNESS_MAX_AGE_MS = 15 * 60 * 1000;
const WITNESS_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) (linkr-db-\d{8}T\d{6}Z\.dump\.age)$/;

/** Lève si le témoin est absent, illisible, du futur ou plus vieux que 15 min. */
export function assertFreshBackupWitness(content: string | null, now: Date): { at: string; backup: string } {
  if (content === null) {
    throw new PurgeRefusal(`témoin de sauvegarde absent (${BACKUP_WITNESS_FILE}) : lancer la purge par deploy/purge.sh --execute`);
  }
  const m = WITNESS_LINE.exec(content.trim());
  if (!m) throw new PurgeRefusal(`témoin de sauvegarde illisible (${BACKUP_WITNESS_FILE})`);
  const age = now.getTime() - Date.parse(m[1]);
  // Une minute de tolérance pour un écart d'horloge, jamais plus.
  if (!Number.isFinite(age) || age < -60_000) throw new PurgeRefusal('témoin de sauvegarde daté du futur');
  if (age > BACKUP_WITNESS_MAX_AGE_MS) {
    throw new PurgeRefusal(`témoin de sauvegarde de plus de 15 minutes (${m[1]}) : relancer deploy/purge.sh --execute`);
  }
  return { at: m[1], backup: m[2] };
}
