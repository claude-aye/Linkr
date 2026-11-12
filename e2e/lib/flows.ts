import fs from 'node:fs';
import { expect, type Browser, type Locator, type BrowserContext, type Page } from '@playwright/test';

import { AUTH_DIR, type Account, type Role, knownAccount, saveAccount, statePath } from './accounts';

/** Adresses FIXES : le cache de géocodage de l'API (30 jours) évite Nominatim après le 1er lancement. */
// Lieu quasi inhabité (aéroport Jean-Lesage) et rayon de 1 km : un vrai client de la région
// de Québec ne doit pas pouvoir réserver ce prestataire de test (cela bloquerait la purge).
// Le client cherche au MÊME endroit : la distance est quasi nulle, donc dans le rayon.
export const E2E_AIRPORT_ADDRESS = 'Aéroport international Jean-Lesage, Québec';
export const E2E_PROVIDER_RADIUS_KM = 1;
export const PROVIDER_ADDRESS = E2E_AIRPORT_ADDRESS;
export const SEARCH_ADDRESS = E2E_AIRPORT_ADDRESS;

/** Préfixe des messages : un échec du service externe ne doit jamais passer pour un défaut applicatif. */
export const GEOCODE_FAILURE =
  'ÉCHEC DE GÉOCODAGE (service externe Nominatim ou son relais), pas forcément un défaut de l’application : ';


/**
 * L3 : message des formulaires quand l'API refuse une action envers des tiers
 * (403 EMAIL_NOT_VERIFIED). Un compte e2e NEUF n'est pas confirmé : le test ne
 * peut pas lire le courriel, il faut cliquer le lien à la main une fois.
 */
export const EMAIL_NOT_VERIFIED = /Confirmez votre adresse courriel pour effectuer cette action/;

/** Échoue avec une cause claire si la page affiche le message L3. */
export async function failIfEmailNotVerified(page: Page, who: string): Promise<void> {
  if (await page.getByText(EMAIL_NOT_VERIFIED).isVisible()) {
    throw new Error(
      `COMPTE NON CONFIRMÉ : ${who} n’a pas confirmé son adresse (L3, 403 EMAIL_NOT_VERIFIED). ` +
        'Ouvrir le courriel de confirmation reçu à l’inscription, cliquer le lien, puis relancer.',
    );
  }
}

/** Message de la page d'inscription sur un 409 (courriel déjà utilisé). */
const EMAIL_TAKEN = /Un compte existe déjà avec ce courriel/;

/**
 * Inscription. Renvoie `exists` si le courriel a déjà un compte (409) : à l'appelant
 * de décider, jamais de tentative de plus ici.
 */
export async function signUp(page: Page, account: Account): Promise<'created' | 'exists'> {
  await page.goto('/signup');
  await page.getByLabel('Prénom').fill('e2e');
  await page.getByLabel('Nom', { exact: true }).fill(account.displayName ? 'Prestataire' : 'Client');
  await page.getByLabel('Courriel').fill(account.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(account.password);
  await page.getByLabel(/conditions d.utilisation/i).check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  const created = page.getByText(/Bonjour, e2e/);
  const taken = page.getByText(EMAIL_TAKEN);
  await expect(created.or(taken)).toBeVisible();
  return (await taken.isVisible()) ? 'exists' : 'created';
}

/**
 * Garantit que le compte du rôle existe et que son mot de passe est connu.
 * - mémorisé dans `.auth/accounts.json` → rien à faire ;
 * - sinon → inscription (mot de passe généré, ou E2E_*_PASSWORD s'il est posé) ;
 *   un 409 avec un mot de passe GÉNÉRÉ échoue : le compte existe et son mot de
 *   passe est inconnu. Aucune autre tentative (ni connexion, ni réinitialisation).
 * Le compte n'est mémorisé qu'après une connexion réussie (voir `sessionFor` / test B).
 */
export async function ensureRegistered(browser: Browser, role: Role): Promise<{ account: Account; isNew: boolean }> {
  const { account, source } = knownAccount(role);
  if (source === 'stored') return { account, isNew: false };

  // Contexte jetable : la connexion qui suit part d'une session vierge.
  const context = await browser.newContext();
  try {
    const outcome = await signUp(await context.newPage(), account);
    if (outcome === 'exists' && source === 'new') {
      const variable = role === 'provider' ? 'E2E_PROVIDER_PASSWORD' : 'E2E_CLIENT_PASSWORD';
      throw new Error(
        `Compte existant, mot de passe inconnu : ${account.email} est déjà inscrit et ` +
          `e2e/.auth/accounts.json ne contient pas son mot de passe. Définir ${variable}.`,
      );
    }
    return { account, isNew: outcome === 'created' };
  } finally {
    await context.close();
  }
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
 * 3. sinon → 1 inscription puis 1 connexion (le compte est alors mémorisé).
 * L'appelant doit fermer avec `closeSession`.
 */
export async function sessionFor(
  browser: Browser,
  role: Role,
): Promise<{ context: BrowserContext; account: Account }> {
  const known = knownAccount(role);
  if (known.source === 'stored' && fs.existsSync(statePath(role))) {
    const context = await browser.newContext({ storageState: statePath(role) });
    const page = await context.newPage();
    await page.goto('/');
    if (await page.getByText(/Bonjour, /).isVisible()) {
      await page.close();
      return { context, account: known.account };
    }
    await context.close();
  }
  const { account } = await ensureRegistered(browser, role);
  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page, account);
  saveAccount(role, account);
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

/** Les candidats voulus sont à Québec : le géocodeur peut placer d’autres régions avant. */
export const QUEBEC_CANDIDATE = /Agglomération de Québec/i;

/**
 * Clique le candidat d'adresse dont le LIBELLÉ correspond, jamais par position.
 * Aucun ne correspond : échec de géocodage listant tous les libellés vus.
 */
export async function pickCandidateByLabel(items: Locator, address: string): Promise<void> {
  const labels = (await items.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
  const index = labels.findIndex((t) => QUEBEC_CANDIDATE.test(t));
  if (index === -1) {
    throw geocodeFailure(
      `aucun candidat de « ${address} » ne correspond à ${QUEBEC_CANDIDATE}. Candidats vus : ` +
        labels.map((t, i) => `${i + 1}. ${t}`).join(' | '),
    );
  }
  await items.nth(index).click();
}

/** Crée le profil prestataire sur /providers/new (géocodage RÉEL de l'adresse fixe). */
export async function createProviderProfile(page: Page, displayName: string): Promise<void> {
  await page.goto('/providers/new');
  await page.getByLabel(/Nom d.affichage/).fill(displayName);
  await page.getByLabel('Adresse de base').fill(PROVIDER_ADDRESS);
  await page.getByLabel('Rayon de service (km)').fill(String(E2E_PROVIDER_RADIUS_KM));
  const submit = page.getByRole('button', { name: 'Créer mon profil' });
  await submit.click();

  const candidates = page.getByText(/Choisissez l.adresse exacte/);
  const noMatch = page.getByRole('button', { name: /Corriger l.adresse/ });
  const unavailable = page.getByRole('button', { name: 'Réessayer' });
  await expect(candidates.or(noMatch).or(unavailable)).toBeVisible({ timeout: 30_000 });
  if (await noMatch.isVisible()) throw geocodeFailure(`« ${PROVIDER_ADDRESS} » n’a donné aucun résultat.`);
  if (await unavailable.isVisible()) throw geocodeFailure('le service d’adresses est indisponible.');

  await pickCandidateByLabel(candidates.locator('xpath=..').getByRole('button'), PROVIDER_ADDRESS);
  await expect(page.getByText(/Localisé/)).toBeVisible();
  await submit.click();
  // L3 : un compte non confirmé reste sur le formulaire avec le message dédié.
  await Promise.race([
    page.waitForURL(/\/dashboard/, { timeout: 30_000 }),
    page.getByText(EMAIL_NOT_VERIFIED).waitFor({ timeout: 30_000 }),
  ]).catch(() => undefined);
  await failIfEmailNotVerified(page, 'le compte prestataire');
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

/** Échappe un texte pour l'insérer tel quel dans une expression régulière. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cherche « Coiffure » autour de l'adresse fixe SEARCH_ADDRESS (géocodage RÉEL)
 * et renvoie le lien de la carte du prestataire `displayName`. Partagé par le
 * test E et le parcours de paiement.
 */
export async function searchProviderCard(page: Page, displayName: string): Promise<Locator> {
  await page.goto('/recherche');
  await page.getByLabel('Métier', { exact: true }).selectOption({ label: 'Coiffure' });
  await page.getByLabel('Adresse', { exact: true }).fill(SEARCH_ADDRESS);
  await page.getByRole('button', { name: 'Rechercher cette adresse' }).click();

  const candidates = page.getByText(/Choisissez l.adresse exacte/);
  const geoDown = page.getByText(/Recherche d.adresse impossible/);
  const noAddress = page.getByText(/Aucune adresse trouvée/);
  await expect(candidates.or(geoDown).or(noAddress)).toBeVisible({ timeout: 30_000 });
  if (await geoDown.first().isVisible()) throw geocodeFailure('la recherche d’adresse est indisponible.');
  if (await noAddress.first().isVisible()) throw geocodeFailure(`« ${SEARCH_ADDRESS} » n’a donné aucun résultat.`);

  await pickCandidateByLabel(candidates.locator('xpath=..').getByRole('link'), SEARCH_ADDRESS);

  // Le prestataire reste découvrable sans Stripe Connect : l'éligibilité
  // (eligibility.sql.ts) ne lit ni stripe_connect_accounts ni charges_enabled.
  const card = page.getByRole('link', { name: new RegExp(escapeRegExp(displayName)) }).first();
  const searchFailed = page.getByText('Recherche impossible');
  const empty = page.getByText(/Aucun (prestataire|professionnel)/);
  await expect(card.or(searchFailed).or(empty.first())).toBeVisible({ timeout: 30_000 });
  if (await searchFailed.isVisible()) {
    throw new Error('ÉCHEC APPLICATIF : « Recherche impossible » (GET /service-providers/discover a échoué).');
  }
  await expect(
    card,
    `Le prestataire « ${displayName} » (Coiffure, rayon ${E2E_PROVIDER_RADIUS_KM} km) devrait figurer dans les résultats`,
  ).toBeVisible();
  return card;
}
