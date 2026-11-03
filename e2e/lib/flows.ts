import fs from 'node:fs';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { AUTH_DIR, type Account, type Role, existingAccount, newAccount, saveAccount, statePath } from './accounts';

/** Adresses FIXES : le cache de géocodage de l'API (30 jours) évite Nominatim après le 1er lancement. */
export const PROVIDER_ADDRESS = '1 rue des Remparts, Québec';
export const SEARCH_ADDRESS = 'Place d’Youville, Québec';

/** Préfixe des messages : un échec du service externe ne doit jamais passer pour un défaut applicatif. */
export const GEOCODE_FAILURE =
  'ÉCHEC DE GÉOCODAGE (service externe Nominatim ou son relais), pas forcément un défaut de l’application : ';


export async function signUp(page: Page, account: Account): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('Prénom').fill('e2e');
  await page.getByLabel('Nom', { exact: true }).fill(account.displayName ? 'Prestataire' : 'Client');
  await page.getByLabel('Courriel').fill(account.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(account.password);
  await page.getByLabel(/conditions d.utilisation/i).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page.getByText(/Bonjour, e2e/)).toBeVisible();
}

export async function logIn(page: Page, account: Account): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Courriel').fill(account.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText(/Bonjour, /)).toBeVisible();
}

/** Mémorise les cookies (rotation du jeton de rafraîchissement : à refaire à chaque fermeture). */
export async function closeSession(context: BrowserContext, role: Role): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: statePath(role) });
  await context.close();
}

/**
 * Une session valide pour le rôle, au moindre coût en budget de débit :
 * 1. état mémorisé encore valide → 0 appel ;
 * 2. compte connu → 1 connexion ;
 * 3. sinon → 1 inscription (le compte est mémorisé).
 * L'appelant doit fermer avec `closeSession`.
 */
export async function sessionFor(
  browser: Browser,
  role: Role,
): Promise<{ context: BrowserContext; account: Account }> {
  const known = existingAccount(role);
  if (known && fs.existsSync(statePath(role))) {
    const context = await browser.newContext({ storageState: statePath(role) });
    const page = await context.newPage();
    await page.goto('/');
    if (await page.getByText(/Bonjour, /).isVisible()) {
      await page.close();
      return { context, account: known };
    }
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  const account = known ?? newAccount(role);
  if (known) await logIn(page, known);
  else {
    await signUp(page, account);
    saveAccount(role, account);
  }
  await page.close();
  return { context, account };
}

/**
 * Clique le premier candidat d'une liste « Choisissez l’adresse exacte » et
 * renvoie le bouton ou le lien cliqué. Si le géocodage échoue, l'erreur le dit
 * en toutes lettres.
 */
export function geocodeFailure(detail: string): Error {
  return new Error(GEOCODE_FAILURE + detail);
}

/** Crée le profil prestataire sur /providers/new (géocodage RÉEL de l'adresse fixe). */
export async function createProviderProfile(page: Page, displayName: string): Promise<void> {
  await page.goto('/providers/new');
  await page.getByLabel(/Nom d.affichage/).fill(displayName);
  await page.getByLabel('Adresse de base').fill(PROVIDER_ADDRESS);
  await page.getByLabel('Rayon de service (km)').fill('25');
  const submit = page.getByRole('button', { name: 'Créer mon profil' });
  await submit.click();

  const candidates = page.getByText(/Choisissez l.adresse exacte/);
  const noMatch = page.getByRole('button', { name: /Corriger l.adresse/ });
  const unavailable = page.getByRole('button', { name: 'Réessayer' });
  await expect(candidates.or(noMatch).or(unavailable)).toBeVisible({ timeout: 30_000 });
  if (await noMatch.isVisible()) throw geocodeFailure(`« ${PROVIDER_ADDRESS} » n’a donné aucun résultat.`);
  if (await unavailable.isVisible()) throw geocodeFailure('le service d’adresses est indisponible.');

  await candidates.locator('xpath=..').getByRole('button').first().click();
  await expect(page.getByText(/Localisé/)).toBeVisible();
  await submit.click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}
