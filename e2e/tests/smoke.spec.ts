import { expect, test, type Page } from '@playwright/test';

import { existingAccount, newAccount, saveAccount, utcDay } from '../lib/accounts';
import {
  SEARCH_ADDRESS,
  closeSession,
  createProviderProfile,
  geocodeFailure,
  logIn,
  pickCandidateByLabel,
  sessionFor,
  signUp,
} from '../lib/flows';

/**
 * Tests de fumée de la version d'essai. Lancés à la main (voir docs/deploy/e2e-smoke.md).
 * Séquentiels : le prestataire créé en B et D est celui que E doit retrouver.
 * Aucun paiement, aucune réinitialisation par courriel, aucun appel hors navigateur.
 */
test.describe.configure({ mode: 'serial' });

// Libellés fr-CA exacts du catalogue (quebec-catalog.seed.ts, `nameTranslations['fr-CA']`).
const REGULATED = ['Plomberie', 'Électricité', 'Menuiserie'];
const INFORMAL = ['Coiffure', 'Esthétique', 'Décoration', 'Homme à tout faire'];

const PROVIDER_NAV = 'Sections du tableau de bord';

test('A — accueil en HTTPS, www redirige vers l’apex', async ({ page, request, baseURL }) => {
  const base = new URL(baseURL!);
  const response = await page.goto('/');
  expect(response?.status(), 'La page d’accueil doit répondre sans erreur').toBeLessThan(400);
  if (base.protocol === 'https:') expect(new URL(page.url()).protocol).toBe('https:');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // Dérivé de E2E_BASE_URL : seulement pour un nom de domaine sans « www. ».
  const isDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(base.hostname) && !/^\d+(\.\d+){3}$/.test(base.hostname);
  test.skip(!isDomain || base.hostname.startsWith('www.') || base.protocol !== 'https:', 'Pas de redirection www à vérifier pour cette URL.');
  const www = await request.get(`https://www.${base.hostname}/`, { maxRedirects: 0 });
  expect(www.status()).toBe(301);
  expect(www.headers()['location']).toBe(`https://${base.hostname}/`);
});

test('B — inscription prestataire, connexion, profil prestataire', async ({ browser }) => {
  let account = existingAccount('provider');
  if (!account) {
    // Inscription dans un contexte jetable : la connexion qui suit part d'une session vierge.
    account = newAccount('provider');
    const signup = await browser.newContext();
    await signUp(await signup.newPage(), account);
    saveAccount('provider', account);
    await signup.close();
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page, account);

  await page.goto('/dashboard');
  const hasProfile = await page.getByRole('navigation', { name: PROVIDER_NAV }).isVisible();
  if (!hasProfile) {
    const displayName = account.displayName ?? `e2e-prestataire-${utcDay()}`;
    await createProviderProfile(page, displayName);
    saveAccount('provider', { ...account, displayName });
  }
  await expect(page.getByRole('navigation', { name: PROVIDER_NAV })).toBeVisible();
  await closeSession(context, 'provider');
});

test('C — Mes métiers : les 7 métiers du catalogue sont proposés', async ({ browser }) => {
  const { context } = await sessionFor(browser, 'provider');
  const page = await context.newPage();
  await page.goto('/dashboard?onglet=metiers');
  await expect(page.getByRole('heading', { name: 'Mes métiers' })).toBeVisible();

  // LE BOGUE CORRIGÉ : un catalogue vide ou une API injoignable se lisait ainsi.
  const failure = page.getByText(/La liste des métiers n.a pas pu être chargée/);
  if (await failure.isVisible()) {
    throw new Error(
      'BOGUE « catalogue vide ou API injoignable » : le tableau de bord affiche « La liste des métiers ' +
        'n’a pas pu être chargée ». Vérifier que service_categories est semée (seed-catalog) et que ' +
        'GET /service-categories répond.',
    );
  }

  const select = page.getByLabel('Ajouter un métier');
  await expect(select).toBeVisible();
  const options = select.locator('option');
  await expect(options, '1 option vide + 7 métiers').toHaveCount(8);
  expect(await options.first().textContent()).toBe('Choisir un métier');

  const disabled = await select.locator('option:disabled').allTextContents();
  const enabled = (await select.locator('option:not(:disabled)').allTextContents()).filter((t) => t !== 'Choisir un métier');
  expect(disabled, '3 métiers réglementés grisés').toHaveLength(3);
  for (const name of REGULATED) {
    expect(disabled.some((t) => t.startsWith(`${name} — `)), `${name} grisé avec sa raison`).toBe(true);
  }
  expect([...enabled].sort()).toEqual([...INFORMAL].sort());
  await closeSession(context, 'provider');
});

test('D — déclarer le métier Coiffure', async ({ browser }) => {
  const { context } = await sessionFor(browser, 'provider');
  const page = await context.newPage();
  await page.goto('/dashboard?onglet=metiers');
  await page.getByLabel('Ajouter un métier').selectOption({ label: 'Coiffure' });
  await page.getByRole('button', { name: 'Déclarer ce métier' }).click();

  // Idempotent : au 2ᵉ lancement le métier est déjà déclaré (409), c'est un succès.
  await expect(
    page.getByText(/Métier déclaré/).or(page.getByText(/Ce métier est déjà déclaré/)),
  ).toBeVisible();
  await page.reload();
  const row = page
    .getByRole('listitem')
    .filter({ hasText: 'Coiffure' })
    .filter({ hasText: 'Aucune vérification requise' });
  await expect(row.first()).toBeVisible();
  await closeSession(context, 'provider');
});

test('E — un client trouve le prestataire en recherche de proximité', async ({ browser }) => {
  const { context } = await sessionFor(browser, 'client');
  const provider = existingAccount('provider');
  const page = await context.newPage();
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

  // Le prestataire de B/D n'a aucune ligne Stripe Connect et reste découvrable :
  // l'éligibilité (eligibility.sql.ts) ne lit ni stripe_connect_accounts ni charges_enabled.
  const expectedName = provider?.displayName ? new RegExp(provider.displayName) : /e2e-prestataire-\d{8}/;
  const card = page.getByRole('link', { name: expectedName });
  const searchFailed = page.getByText('Recherche impossible');
  const empty = page.getByText(/Aucun (prestataire|professionnel)/);
  await expect(card.first().or(searchFailed).or(empty.first())).toBeVisible({ timeout: 30_000 });
  if (await searchFailed.isVisible()) {
    throw new Error('ÉCHEC APPLICATIF : « Recherche impossible » (GET /service-providers/discover a échoué).');
  }
  await expect(
    card.first(),
    'Le prestataire créé en B et D (Coiffure, rayon 25 km) devrait figurer dans les résultats',
  ).toBeVisible();
  await closeSession(context, 'client');
});

test('F — mauvais mot de passe : message clair, pas de crash', async ({ browser }) => {
  const account = existingAccount('provider') ?? existingAccount('client');
  test.skip(!account, 'Aucun compte connu : B doit avoir réussi.');
  const context = await browser.newContext();
  const page: Page = await context.newPage();
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await page.goto('/login');
  await page.getByLabel('Courriel').fill(account!.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill('Mauvais-mot-de-passe-1!');
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await expect(page.getByRole('alert').filter({ hasText: /Identifiants invalides/ })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  expect(crashes, 'Aucune erreur JavaScript non interceptée').toEqual([]);
  await context.close();
});
