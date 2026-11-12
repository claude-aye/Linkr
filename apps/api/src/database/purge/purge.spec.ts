import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildPlan, isBlocked, Queryable } from './purge-plan';
import { executePurge, resolveInStorage } from './purge-execute';
import {
  accountCounts,
  assertClosedLists,
  assertFreshBackupWitness,
  assertModifiable,
  assertSingleFixedRow,
  BACKUP_WITNESS_MAX_AGE_MS,
  classifyAccount,
  COLUMN_SCOPED_SELECT,
  confirmationPhrase,
  FORBIDDEN_COLUMNS,
  DELETE_ORDER,
  isSafeStorageKey,
  LEGACY_E2E_EMAIL_PATTERN,
  LEGACY_E2E_EMAIL_SQL_PATTERN,
  planFingerprint,
  planPhrase,
  PROTECTED_TABLES,
  PurgeRefusal,
  roleGrantSql,
} from './purge-rules';

const base = { firstName: 'e2e', systemRole: 'USER', deletedAtUtc: null };

describe('purge e2e — sélection des comptes', () => {
  it('retient les deux comptes fixes en mode transactions seulement (égalité exacte de l’adresse brute)', () => {
    for (const email of ['e2e-prestataire@linkrapp.com', 'e2e-client@linkrapp.com']) {
      const c = classifyAccount({ ...base, id: 'u', email });
      expect(c.kind).toBe('retained');
      if (c.kind === 'retained') expect(c.account.mode).toBe('TRANSACTIONS_ONLY');
    }
  });

  it('retient un ancien compte Gmail au format exact de newAccount() en suppression complète', () => {
    const c = classifyAccount({ ...base, id: 'u', email: 'e2e+prestataire-20261102-ab12cd34@gmail.com' });
    expect(c.kind).toBe('retained');
    if (c.kind === 'retained') {
      expect(c.account.mode).toBe('FULL');
      expect(c.account.label).not.toContain('@');
    }
  });

  it.each([
    'e2e+x@gmail.com',
    'xe2e+client-20261102-ab12cd34@gmail.com',
    'e2e+client-20261102-ab12cd34@gmail.com.evil.test',
    'e2e+client-20261102-ab12cd345@gmail.com',
    'e2e+client-2026110-ab12cd34@gmail.com',
    'e2e+client-20261102-AB12CD3@gmail.com',
    'e2e+clients-20261102-ab12cd34@gmail.com',
    'e2e+client-20261102-ab12cd34@gmailxcom',
    'e2e+client-20261102-ab12cd34@googlemail.com',
    'e2e-client-20261102-ab12cd34@gmail.com',
    'e2e-prestataire@linkrapp.com.evil.test',
    'e2e-prestataire2@linkrapp.com',
    ' e2e-client@linkrapp.co',
  ])('refuse une adresse proche : %s', (email) => {
    expect(classifyAccount({ ...base, id: 'u', email }).kind).toBe('ignored');
  });

  it.each([
    ['casse différente', 'E2E-Client@LinkrApp.com'],
    ['une seule majuscule', 'e2e-client@Linkrapp.com'],
    ['signe Kelvin U+212A (lower() le change en « k »)', 'e2e-client@lin\u212Arapp.com'],
    ['ancienne adresse en majuscules', 'E2E+CLIENT-20261102-AB12CD34@GMAIL.COM'],
    ['ancienne adresse, domaine en majuscules', 'e2e+client-20261102-ab12cd34@Gmail.com'],
    ['ancienne adresse, préfixe en majuscules', 'E2E+client-20261102-ab12cd34@gmail.com'],
    ['espace en tête', ' e2e-client@linkrapp.com'],
    ['espace en fin', 'e2e-client@linkrapp.com '],
  ])('ignore une adresse qui n’est pas e2e au caractère près (%s)', (_label, email) => {
    expect(classifyAccount({ ...base, id: 'u', email }).kind).toBe('ignored');
  });

  it('la regex des anciens comptes est sensible à la casse (aucun drapeau i)', () => {
    expect(LEGACY_E2E_EMAIL_PATTERN.flags).toBe('');
    expect(LEGACY_E2E_EMAIL_PATTERN.test('E2E+client-20261102-ab12cd34@gmail.com')).toBe(false);
  });

  it('exige le prénom « e2e » pour un compte FIXE aussi', () => {
    expect(classifyAccount({ ...base, firstName: 'Carol', id: 'u', email: 'e2e-client@linkrapp.com' }).kind).toBe('ignored');
    expect(classifyAccount({ ...base, firstName: 'E2E', id: 'u', email: 'e2e-prestataire@linkrapp.com' }).kind).toBe('ignored');
  });

  it('refuse net une adresse fixe qui correspond à plus d’une ligne', () => {
    expect(() => assertSingleFixedRow(['e2e-client@linkrapp.com', 'e2e-prestataire@linkrapp.com'])).not.toThrow();
    expect(() => assertSingleFixedRow(['e2e-client@linkrapp.com', 'e2e-client@linkrapp.com'])).toThrow(PurgeRefusal);
  });

  it('exige le prénom « e2e » pour un ancien compte', () => {
    const c = classifyAccount({ ...base, firstName: 'Carol', id: 'u', email: 'e2e+client-20261102-ab12cd34@gmail.com' });
    expect(c.kind).toBe('ignored');
  });

  it('ne retient pas un compte fixe déjà supprimé en douceur', () => {
    const c = classifyAccount({ ...base, deletedAtUtc: new Date(), id: 'u', email: 'e2e-client@linkrapp.com' });
    expect(c.kind).toBe('ignored');
  });

  it('la regex SQL et la regex JS sont le même motif', () => {
    expect(LEGACY_E2E_EMAIL_SQL_PATTERN).toBe(LEGACY_E2E_EMAIL_PATTERN.source);
  });
});

describe('purge e2e — listes fermées et phrase', () => {
  it('les tables modifiables et protégées ne se recoupent pas', () => {
    expect(() => assertClosedLists()).not.toThrow();
    expect(() => assertClosedLists(['users', 'service_items'], PROTECTED_TABLES)).toThrow(PurgeRefusal);
  });

  it('aucune table du catalogue, du schéma ou des migrations n’est modifiable', () => {
    for (const t of PROTECTED_TABLES) expect(() => assertModifiable(t)).toThrow(PurgeRefusal);
    expect(DELETE_ORDER).not.toContain('organizations');
    expect(DELETE_ORDER).not.toContain('demand_signals');
  });

  it('l’empreinte change dès qu’un identifiant visé change', () => {
    const accounts = [{ id: 'a', mode: 'FULL' as const }];
    const a = planFingerprint(accounts, { users: ['a'] });
    expect(planFingerprint(accounts, { users: ['a'] })).toBe(a);
    expect(planFingerprint(accounts, { users: ['a'], notifications: ['n'] })).not.toBe(a);
    expect(planFingerprint([{ id: 'a', mode: 'TRANSACTIONS_ONLY' }], { users: ['a'] })).not.toBe(a);
  });

  it('la phrase porte le nombre de comptes et l’empreinte', () => {
    expect(confirmationPhrase(3, 'abc123def456')).toBe('PURGER E2E 3 COMPTES abc123def456');
  });

  it('la phrase ne compte que les comptes supprimés EN ENTIER (M5)', () => {
    const accounts = [{ mode: 'FULL' as const }, { mode: 'TRANSACTIONS_ONLY' as const }, { mode: 'TRANSACTIONS_ONLY' as const }];
    expect(accountCounts(accounts)).toEqual({ full: 1, kept: 2 });
    expect(planPhrase(accounts, 'abc123def456')).toBe('PURGER E2E 1 COMPTES abc123def456');
    expect(planPhrase(accounts.slice(1), 'abc123def456')).toBe('PURGER E2E 0 COMPTES abc123def456');
  });
});

describe('purge e2e — témoin de sauvegarde (I4)', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const line = (at: string): string => `${at} linkr-db-20261104T115500Z.dump.age\n`;

  it('accepte un témoin récent et rend le nom de la sauvegarde', () => {
    expect(assertFreshBackupWitness(line('2026-11-04T11:55:00Z'), now)).toEqual({
      at: '2026-11-04T11:55:00Z',
      backup: 'linkr-db-20261104T115500Z.dump.age',
    });
  });

  it('accepte un témoin de 15 minutes pile', () => {
    expect(BACKUP_WITNESS_MAX_AGE_MS).toBe(15 * 60 * 1000);
    expect(() => assertFreshBackupWitness(line('2026-11-04T11:45:00Z'), now)).not.toThrow();
  });

  it.each([
    ['absent', null],
    ['vide', ''],
    ['illisible', 'sauvegarde faite\n'],
    ['sans nom de sauvegarde', '2026-11-04T11:55:00Z\n'],
    ['avec un nom inattendu', '2026-11-04T11:55:00Z ../../etc/passwd\n'],
    ['de plus de 15 minutes', line('2026-11-04T11:44:59Z')],
    ['daté du futur', line('2026-11-04T12:02:00Z')],
  ])('refuse un témoin %s', (_label, content) => {
    expect(() => assertFreshBackupWitness(content as string | null, now)).toThrow(PurgeRefusal);
  });
});

describe('purge e2e — droits du rôle (M2)', () => {
  it('ne donne jamais SELECT sur les hachés de mot de passe et de jeton', () => {
    const sql = roleGrantSql();
    expect(sql).not.toMatch(/password_hash|token_hash/);
    expect(sql).toContain('GRANT SELECT (id, user_id) ON TABLE user_auth_providers TO linkr_purge;');
    expect(sql).toContain('GRANT SELECT (id, user_id) ON TABLE password_reset_tokens TO linkr_purge;');
    const fullGrant = sql.split('\n').find((l) => l.startsWith('GRANT SELECT, DELETE ON TABLE')) ?? '';
    for (const t of Object.keys(COLUMN_SCOPED_SELECT)) expect(fullGrant).not.toContain(t);
    for (const [t] of FORBIDDEN_COLUMNS) expect(Object.keys(COLUMN_SCOPED_SELECT)).toContain(t);
  });

  it('chaque table de la liste fermée reçoit DELETE (nécessaire au verrou)', () => {
    const grants = roleGrantSql().split('\n').filter((l) => /^GRANT (SELECT, )?DELETE ON TABLE/.test(l)).join(' ');
    for (const t of DELETE_ORDER) expect(grants.split(/[ ,;]+/)).toContain(t);
  });
});

describe('purge e2e — clés de stockage', () => {
  it.each(['../etc/passwd', '/etc/passwd', 'portfolio/../../x', 'autre/a/b.webp', 'portfolio\\a', ''])(
    'refuse %p',
    (key) => {
      expect(isSafeStorageKey(key)).toBe(false);
      expect(resolveInStorage('/data/uploads', key)).toBeNull();
    },
  );

  it('accepte une clé de portfolio et la résout dans le volume', () => {
    const key = 'portfolio/0b9e4a3c-0000-4000-8000-000000000001/aa.webp';
    expect(isSafeStorageKey(key)).toBe(true);
    expect(resolveInStorage('/data/uploads', key)).toBe(resolve('/data/uploads', key));
  });
});

/** Base factice : chaque requête répond selon la table de son premier FROM. */
function fakeDb(byTable: Record<string, Record<string, unknown>[]>): Queryable {
  return {
    async query<R>(text: string) {
      const table = /FROM\s+([a-z_]+)/.exec(text)?.[1] ?? '';
      return { rows: (byTable[table] ?? []) as R[], rowCount: 0 };
    },
  };
}

const LEGACY = { id: '00000000-0000-4000-8000-000000000001', email: 'e2e+client-20261102-ab12cd34@gmail.com', first_name: 'e2e', system_role: 'USER', deleted_at_utc: null };

describe('purge e2e — plan', () => {
  it('refuse net un compte ADMIN dans la liste (D4)', async () => {
    const db = fakeDb({ users: [{ ...LEGACY, system_role: 'ADMIN' }] });
    await expect(buildPlan(db)).rejects.toThrow(PurgeRefusal);
  });

  it('refuse net deux lignes pour une même adresse fixe', async () => {
    const fixed = { ...LEGACY, email: 'e2e-client@linkrapp.com' };
    const db = fakeDb({ users: [fixed, { ...fixed, id: '00000000-0000-4000-8000-000000000002', deleted_at_utc: new Date() }] });
    await expect(buildPlan(db)).rejects.toThrow(PurgeRefusal);
  });

  it('s’arrête si le catalogue pointe vers un compte visé (D6)', async () => {
    const db = fakeDb({
      users: [LEGACY],
      service_items: [{ id: 'item', suggested_by_user_id: LEGACY.id, approved_by_user_id: null }],
    });
    const plan = await buildPlan(db);
    expect(plan.catalogBlockers).toHaveLength(1);
    expect(isBlocked(plan)).toBe(true);
  });

  it('s’arrête si une demande d’un compte hors liste vise un prestataire e2e', async () => {
    const db = fakeDb({
      users: [LEGACY],
      service_providers: [{ id: 'p', user_id: LEGACY.id }],
      service_requests: [
        { id: 'r', client_user_id: 'tiers', requested_service_provider_id: 'p', assigned_service_provider_id: null },
      ],
    });
    const plan = await buildPlan(db);
    expect(plan.violations.map((v) => v.table)).toContain('service_requests');
    expect(plan.rows.service_requests).toEqual([]);
    expect(isBlocked(plan)).toBe(true);
  });

  it('le plan ne pose aucun verrou ; l’exécution verrouille les 21 tables AVANT de lire le plan', async () => {
    const seen: string[] = [];
    const db: Queryable = {
      async query<R>(text: string) {
        seen.push(text);
        return { rows: [] as R[], rowCount: 0 };
      },
    };
    await buildPlan(db);
    expect(seen.some((s) => /FOR UPDATE|LOCK TABLE/.test(s))).toBe(false);

    seen.length = 0;
    // Plan vide : aucune phrase exigée, aucune suppression, aucun COMMIT.
    await expect(executePurge(db, { confirm: '', outDir: '/nulle-part', storageDir: '/nulle-part' })).resolves.toMatchObject({ committed: false });
    expect(seen.some((s) => s.startsWith('DELETE'))).toBe(false);
    expect(seen.includes('COMMIT')).toBe(false);
    const locks = seen.filter((s) => s.startsWith('LOCK TABLE'));
    expect(locks).toEqual(DELETE_ORDER.map((t) => `LOCK TABLE ${t} IN SHARE ROW EXCLUSIVE MODE`));
    const firstPlanRead = seen.findIndex((s) => /FROM\s+users/.test(s));
    expect(seen.lastIndexOf(locks[locks.length - 1])).toBeLessThan(firstPlanRead);
    expect(seen.some((s) => s.includes('FOR UPDATE'))).toBe(false);
    expect(seen[seen.length - 1]).toBe('ROLLBACK');
  });
});

describe('purge e2e — code source', () => {
  const dir = __dirname;
  const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

  it('ne normalise jamais une adresse (aucun lower() ni toLowerCase())', () => {
    for (const f of sources) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect({ f, hit: /lower\(|toLowerCase\(|toUpperCase\(|upper\(|ILIKE/i.exec(text)?.[0] ?? null }).toEqual({ f, hit: null });
    }
  });

  it('ne contient aucun ordre de schéma ni de vidage de table', () => {
    expect(sources.length).toBeGreaterThanOrEqual(4);
    for (const f of sources) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect({ f, hit: /\b(DROP|ALTER|TRUNCATE)\b/i.exec(text)?.[0] ?? null }).toEqual({ f, hit: null });
    }
  });

  it('ne lit aucune clé Stripe et n’appelle aucun service externe', () => {
    for (const f of sources) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect({ f, stripe: /STRIPE_SECRET|from 'stripe'|fetch\(|https?:\/\//.test(text) }).toEqual({ f, stripe: false });
    }
  });

  it('docs/deploy/purge.md recopie exactement le SQL du rôle', () => {
    const doc = readFileSync(join(dir, '../../../../../docs/deploy/purge.md'), 'utf8');
    expect(doc).toContain(roleGrantSql());
  });
});
