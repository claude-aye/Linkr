import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type Role = 'provider' | 'client';

export interface Account {
  email: string;
  password: string;
  /** Nom d'affichage du prestataire (e2e-prestataire-aaaammjj) ; absent pour le client. */
  displayName?: string;
}

export const AUTH_DIR = path.join(__dirname, '..', '.auth');
const ACCOUNTS_FILE = path.join(AUTH_DIR, 'accounts.json');

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

/** Le compte à réutiliser (variables d'environnement d'abord, puis le fichier local), ou `null`. */
export function existingAccount(role: Role): Account | null {
  const prefix = role === 'provider' ? 'E2E_PROVIDER' : 'E2E_CLIENT';
  const email = process.env[`${prefix}_EMAIL`]?.trim();
  const password = process.env[`${prefix}_PASSWORD`];
  const stored = readStore()[role];
  if (email && password) {
    // Le nom d'affichage n'est connu que si la suite a elle-même créé ce profil.
    return {
      email,
      password,
      displayName: stored?.email === email ? stored.displayName : undefined,
    };
  }
  return stored ?? null;
}

/** Nouveau compte reconnaissable pour la purge : courriel e2e+…@gmail.com, prénom « e2e ». */
export function newAccount(role: Role): Account {
  const suffix = crypto.randomBytes(4).toString('hex');
  return {
    email: `e2e+${role === 'provider' ? 'prestataire' : 'client'}-${utcDay()}-${suffix}@gmail.com`,
    password: `E2e-${crypto.randomBytes(9).toString('base64url')}!`,
    displayName: role === 'provider' ? `e2e-prestataire-${utcDay()}` : undefined,
  };
}
