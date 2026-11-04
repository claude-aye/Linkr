import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildPlan, isBlocked, Queryable } from './purge-plan';
import { executePurge, resolveInStorage } from './purge-execute';
import {
  assertClosedLists,
  assertModifiable,
  classifyAccount,
  confirmationPhrase,
  DELETE_ORDER,
  isSafeStorageKey,
  LEGACY_E2E_EMAIL_PATTERN,
  LEGACY_E2E_EMAIL_SQL_PATTERN,
  planFingerprint,
  PROTECTED_TABLES,
  PurgeRefusal,
  roleGrantSql,
} from './purge-rules';

const base = { firstName: 'e2e', systemRole: 'USER', deletedAtUtc: null };

describe('purge e2e — sélection des comptes', () => {
  it('retient les deux comptes fixes en mode transactions seulement (égalité exacte, casse ignorée)', () => {
    for (const email of ['e2e-prestataire@linkrapp.com', 'E2E-Client@LinkrApp.com']) {
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

  it('le plan ne pose aucun verrou ; l’exécution verrouille les 20 tables AVANT de lire le plan', async () => {
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
    await expect(executePurge(db, { confirm: 'faux', outDir: '/nulle-part', storageDir: '/nulle-part' })).rejects.toThrow(PurgeRefusal);
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
