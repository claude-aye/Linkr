import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type Role = 'provider' | 'client';

export interface Account {
  email: string;
  password: string;
  /** Nom d'affichage du profil prestataire ; absent pour le client. */
  displayName?: string;
}

export const AUTH_DIR = path.join(__dirname, '..', '.auth');
const ACCOUNTS_FILE = path.join(AUTH_DIR, 'accounts.json');

/**
 * Adresses FIXES, sur le domaine de Linkr (une règle Cloudflare Email Routing par
 * adresse). Jamais d'alias `e2e+…@gmail.com` : chez Gmail, la partie locale « e2e »
 * est la boîte d'un inconnu, qui recevrait les courriels transactionnels.
 */
export const FIXED_EMAILS: Record<Role, string> = {
  provider: 'e2e-prestataire@linkrapp.com',
  client: 'e2e-client@linkrapp.com',
};

/**
 * Nom du profil prestataire. Fixe, et distinct des profils `e2e-prestataire-aaaammjj`
 * des anciens comptes Gmail abandonnés (encore en base, encore découvrables) :
 * une recherche par ce nom ne peut tomber que sur le compte de cette suite.
 */
export const PROVIDER_DISPLAY_NAME = 'e2e-prestataire-linkrapp';

/** Date UTC au format aaaammjj — jamais dépendante du fuseau du poste. */
export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10).replaceAll('-', '');
}

export function statePath(role: Role): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

function readStore(): Partial<Record<Role, Account>> {
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function saveAccount(role: Role, account: Account): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const store = readStore();
  store[role] = account;
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}

/** Adresse du rôle : la variable E2E_*_EMAIL si elle est posée (domaine linkrapp.com seulement), sinon l'adresse fixe. */
export function accountEmail(role: Role): string {
  const variable = role === 'provider' ? 'E2E_PROVIDER_EMAIL' : 'E2E_CLIENT_EMAIL';
  const override = process.env[variable]?.trim();
  if (!override) return FIXED_EMAILS[role];
  if (!/^[^@\s]+@linkrapp\.com$/i.test(override)) {
    throw new Error(
      `${variable} doit être une adresse @linkrapp.com (règle Cloudflare Email Routing). ` +
        'Une adresse ailleurs, en particulier un alias Gmail « e2e+… », enverrait les courriels de test à un inconnu.',
    );
  }
  return override;
}

/**
 * Le compte du rôle tel qu'on le connaît, sans rien appeler :
 * - `stored` : mot de passe mémorisé dans `.auth/accounts.json` pour CETTE adresse
 *   (une entrée d'une autre adresse — par exemple un ancien compte Gmail — est ignorée) ;
 * - `env` : mot de passe donné par E2E_*_PASSWORD (compte créé ailleurs) ;
 * - `new` : rien de connu, un mot de passe est généré pour l'inscription.
 */
export function knownAccount(role: Role): { account: Account; source: 'stored' | 'env' | 'new' } {
  const email = accountEmail(role);
  const stored = readStore()[role];
  const storedHere = stored?.email === email ? stored : undefined;
  const displayName = role === 'provider' ? (storedHere?.displayName ?? PROVIDER_DISPLAY_NAME) : undefined;

  if (storedHere) return { account: { ...storedHere, displayName }, source: 'stored' };
  const envPassword = process.env[role === 'provider' ? 'E2E_PROVIDER_PASSWORD' : 'E2E_CLIENT_PASSWORD'];
  if (envPassword) return { account: { email, password: envPassword, displayName }, source: 'env' };
  return {
    account: { email, password: `E2e-${crypto.randomBytes(9).toString('base64url')}!`, displayName },
    source: 'new',
  };
}
