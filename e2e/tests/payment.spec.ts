import { expect, test, type BrowserContext, type Locator, type Page, type Response } from '@playwright/test';

import { PROVIDER_DISPLAY_NAME, knownAccount } from '../lib/accounts';
import { SEARCH_ADDRESS, closeSession, escapeRegExp, geocodeFailure, pickCandidateByLabel, searchProviderCard, sessionFor } from '../lib/flows';
import {
  PAYMENT_TITLE_PATTERN,
  TEST_CARD_NUMBER,
  cardFrame,
  desiredWindow,
  expectTestModeSetupConfirm,
  expectTrialBanner,
  installPaymentGuards,
  moneyIn,
  paymentRequestTitle,
  typeTestCard,
  type PaymentGuards,
} from '../lib/payment';

/**
 * PARCOURS DE PAIEMENT DE BOUT EN BOUT — `pnpm test:paiement` seulement.
 *
 * Un client réserve « Coupe homme » chez le prestataire e2e, enregistre la carte de
 * test, le prestataire accepte (acompte de 20 % prélevé hors session), démarre et
 * termine, le client confirme (solde de 80 %), et le webhook Stripe fait passer la
 * demande à « Payée ».
 *
 * Exclu de `pnpm test` (testIgnore de playwright.config.ts) ; la configuration
 * dédiée refuse de se charger sans E2E_ALLOW_PAYMENT=1, et ce fichier aussi.
 */
if (process.env.E2E_ALLOW_PAYMENT !== '1') {
  throw new Error('PARCOURS DE PAIEMENT REFUSÉ : E2E_ALLOW_PAYMENT doit valoir « 1 ».');
}

/** Service posé par la suite chez le prestataire (catalogue Coiffure, prix fixe). */
const SERVICE_LABEL = 'Coupe homme';
const SERVICE_PRICE = '40';
const SERVICE_PRICE_DISPLAY = '40,00 $';

/** Titres de la bande Stripe Connect qui veulent dire « ne peut pas encore encaisser » (connect-status-band.tsx). */
const CONNECT_BLOCKING_TITLES = [
  'Configurez vos paiements',
  'Votre compte de paiement est bloqué',
  'Vérification en cours',
  'Stripe a besoin d’informations',
  'Vous ne pouvez pas encore être payé',
];
/** Encaissement possible, versements bloqués : l'acompte passe, on ne fait qu'avertir. */
const CONNECT_PAYOUTS_SUSPENDED = 'Vos versements sont suspendus';

/** Pastilles client d'une demande encore ouverte (request-card.tsx). */
const OPEN_BADGES = ['En attente', 'Acceptée', 'En cours de réalisation', 'Complétée'];

const PROVIDER_NAV = 'Sections du tableau de bord';
const WEBHOOK_TIMEOUT_MS = 90_000;

function warn(message: string): void {
  test.info().annotations.push({ type: 'warning', description: message });
  console.warn(`⚠️  ${message}`);
}

/** Attend la réponse d'un POST du relais BFF dont le chemin finit par `suffix`. */
function bffPost(page: Page, suffix: RegExp): Promise<Response> {
  return page.waitForResponse((r) => r.request().method() === 'POST' && suffix.test(new URL(r.url()).pathname));
}

/** La carte (`<li>`) qui porte ce titre exact, dans la liste de la page. */
function cardWithTitle(page: Page, title: string): Locator {
  return page.getByRole('listitem').filter({ hasText: new RegExp(escapeRegExp(title)) }).first();
}

test('Paiement — réservation, acompte, exécution, solde, webhook', async ({ browser, baseURL }) => {
  const baseOrigin = new URL(baseURL!).origin;
  const title = paymentRequestTitle();
  test.info().annotations.push({ type: 'demande', description: title });

  const provider = await sessionFor(browser, 'provider');
  const client = await sessionFor(browser, 'client');
  const contexts: Array<[BrowserContext, 'provider' | 'client']> = [
    [provider.context, 'provider'],
    [client.context, 'client'],
  ];
  const guards: PaymentGuards[] = [];
  for (const [context] of contexts) guards.push(await installPaymentGuards(context, baseOrigin));
  const assertGuards = () => guards.forEach((g) => g.assertClean());

  const providerPage = await provider.context.newPage();
  const clientPage = await client.context.newPage();
  const displayName = knownAccount('provider').account.displayName ?? PROVIDER_DISPLAY_NAME;

  try {
    // ─── 0. Préconditions ───────────────────────────────────────────────────
    await test.step('0. Préconditions : paiements actifs, service « Coupe homme »', async () => {
      await providerPage.goto('/dashboard');
      await expect(
        providerPage.getByRole('navigation', { name: PROVIDER_NAV }),
        'Le compte e2e-prestataire n’a pas de profil prestataire : lancer « pnpm test » d’abord.',
      ).toBeVisible();

      for (const blocking of CONNECT_BLOCKING_TITLES) {
        if (await providerPage.getByText(blocking, { exact: true }).isVisible()) {
          throw new Error(
            `PRÉCONDITION : le prestataire e2e ne peut pas encore encaisser (« ${blocking} »). Faire à la main ` +
              'l’onboarding Stripe Connect et revenir par le bouton de Stripe vers le site (page de retour).',
          );
        }
      }
      if (await providerPage.getByText(CONNECT_PAYOUTS_SUSPENDED, { exact: true }).isVisible()) {
        warn('Versements suspendus chez Stripe : l’encaissement fonctionne, l’argent reste sur le solde Stripe.');
      }

      await providerPage.goto('/dashboard?onglet=metiers');
      const trade = providerPage
        .getByRole('listitem')
        .filter({ has: providerPage.getByText('Coiffure', { exact: true }) })
        .first();
      await expect(trade, 'Le métier Coiffure doit être déclaré : lancer « pnpm test » (test D) d’abord.').toBeVisible();

      const service = trade.getByRole('listitem').filter({ hasText: SERVICE_LABEL });
      if ((await service.count()) === 0) {
        await trade.getByRole('button', { name: /Ajouter un service/ }).click();
        await trade.getByLabel('Service', { exact: true }).selectOption({ label: SERVICE_LABEL });
        await trade.getByLabel('Prix', { exact: true }).fill(SERVICE_PRICE);
        await trade.getByRole('button', { name: 'Ajouter ce service' }).click();
        // Un 409 (« déjà offert ») compte comme un succès.
        await expect(
          providerPage.getByText(/Service ajouté/).or(providerPage.getByText(/Ce service est déjà offert/)),
        ).toBeVisible();
        await providerPage.reload();
      }
      const row = trade.getByRole('listitem').filter({ hasText: SERVICE_LABEL }).first();
      await expect(row).toBeVisible();
      if (await row.getByText('Désactivé', { exact: true }).isVisible()) {
        throw new Error(`PRÉCONDITION : le service « ${SERVICE_LABEL} » est désactivé. Le réactiver dans « Mes métiers ».`);
      }
      const price = moneyIn(await row.textContent());
      if (price !== SERVICE_PRICE_DISPLAY) {
        warn(`Le service « ${SERVICE_LABEL} » est à ${price ?? 'un prix illisible'} et non ${SERVICE_PRICE_DISPLAY}.`);
      }
      assertGuards();
    });

    // ─── 1. Carte de test ───────────────────────────────────────────────────
    await test.step('1. Carte de test enregistrée, mode test prouvé (livemode = false)', async () => {
      await clientPage.goto('/account/payment-methods');
      await expectTrialBanner(clientPage, 'Ajouter une carte');
      await clientPage.getByRole('button', { name: 'Ajouter une carte' }).click();
      const dialog = clientPage.getByRole('dialog', { name: 'Ajouter une carte' });
      await expect(dialog).toBeVisible();

      const frame = await cardFrame(clientPage);
      await typeTestCard(frame, TEST_CARD_NUMBER);

      const confirmed = expectTestModeSetupConfirm(client.context);
      await dialog.getByRole('button', { name: 'Enregistrer la carte' }).click();
      await confirmed;
      await expect(clientPage.getByRole('status').filter({ hasText: 'Carte enregistrée' })).toBeVisible({ timeout: 30_000 });
      assertGuards();
    });

    // ─── 2. Demande ─────────────────────────────────────────────────────────
    let price = '';
    await test.step('2. Demande de réservation directe', async () => {
      // Orpheline d'un lancement précédent : signalée, jamais reprise ni annulée.
      await clientPage.goto('/requests');
      const previous = clientPage.getByRole('listitem').filter({ hasText: PAYMENT_TITLE_PATTERN });
      for (const card of await previous.all()) {
        for (const badge of OPEN_BADGES) {
          if (await card.getByText(badge, { exact: true }).isVisible()) {
            const orphan = (await card.textContent())?.match(PAYMENT_TITLE_PATTERN)?.[0] ?? '?';
            warn(`Demande orpheline d’un lancement précédent : ${orphan} (« ${badge} »). Non reprise.`);
          }
        }
      }

      const providerCard = await searchProviderCard(clientPage, displayName);
      await providerCard.click();
      await expect(clientPage.getByRole('heading', { name: new RegExp(escapeRegExp(displayName)) })).toBeVisible();
      const serviceRow = clientPage.getByRole('listitem').filter({ hasText: SERVICE_LABEL }).first();
      price = moneyIn(await serviceRow.textContent()) ?? '';
      expect(price, 'Prix du service lisible sur le profil').not.toBe('');
      await serviceRow.getByRole('link', { name: 'Demander' }).click();

      await expect(clientPage.getByRole('heading', { name: /Demande à/ })).toBeVisible();
      expect(moneyIn(await clientPage.locator('form').textContent()), 'Montant estimé = prix du profil').toBe(price);
      await clientPage.getByLabel('Titre').fill(title);
      await clientPage.getByLabel('Description').fill('Demande automatique du parcours de paiement e2e. Aucun déplacement réel.');
      await clientPage.getByLabel('Adresse du service').fill(SEARCH_ADDRESS);
      const slot = desiredWindow();
      await clientPage.getByLabel('Début souhaité').fill(slot.start);
      await clientPage.getByLabel('Fin souhaitée').fill(slot.end);

      const send = clientPage.getByRole('button', { name: 'Envoyer la demande' });
      await send.click();
      const candidates = clientPage.getByText(/Choisissez l.adresse exacte/);
      const unresolved = clientPage.getByRole('button', { name: 'Envoyer quand même' });
      await expect(candidates.or(unresolved)).toBeVisible({ timeout: 30_000 });
      if (await unresolved.isVisible()) throw geocodeFailure(`« ${SEARCH_ADDRESS} » n’a pas pu être localisée.`);
      await pickCandidateByLabel(candidates.locator('xpath=..').getByRole('button').filter({ hasNotText: 'Aucune de ces adresses' }), SEARCH_ADDRESS);
      await expect(clientPage.getByText(/Localisé/)).toBeVisible();

      const created = bffPost(clientPage, /^\/api\/service-requests$/);
      await send.click();
      expect((await created).status(), 'POST /api/service-requests').toBe(201);
      await expect(clientPage.getByRole('heading', { name: 'Demande envoyée' })).toBeVisible();
      assertGuards();
    });

    // ─── 3. Acceptation et acompte ──────────────────────────────────────────
    await test.step('3. Acceptation par le prestataire, acompte prélevé (200)', async () => {
      await providerPage.goto('/dashboard?onglet=en-attente');
      const card = cardWithTitle(providerPage, title);
      await expect(card, 'La demande doit apparaître dans « En attente » du prestataire').toBeVisible();
      await card.getByRole('button', { name: 'Accepter' }).click();

      const dialog = providerPage.getByRole('dialog', { name: 'Accepter la demande' });
      await expect(dialog).toBeVisible();
      expect(moneyIn(await dialog.textContent()), 'Montant total estimé = prix du profil').toBe(price);
      await expectTrialBanner(providerPage, 'Accepter');

      const accepted = bffPost(providerPage, /\/api\/service-requests\/[^/]+\/accept$/);
      await dialog.getByRole('button', { name: 'Accepter', exact: true }).click();
      const status = (await accepted).status();
      if (status === 202) {
        throw new Error('ACOMPTE NON RÉGLÉ (202) : la demande est assignée mais l’acompte n’a pas été prélevé.');
      }
      expect(status, 'POST …/accept').toBe(200);
      await expect(dialog).toBeHidden();

      await providerPage.goto('/dashboard?onglet=jobs');
      const job = cardWithTitle(providerPage, title);
      await expect(job).toBeVisible();
      await expect(job.getByRole('button', { name: 'Relancer le prélèvement' })).toHaveCount(0);

      await clientPage.goto('/requests');
      const request = cardWithTitle(clientPage, title);
      await expect(request.getByText('Acceptée', { exact: true })).toBeVisible();
      await expect(request.getByText('Paiement à confirmer', { exact: true })).toHaveCount(0);
      assertGuards();
    });

    // ─── 4. Exécution ───────────────────────────────────────────────────────
    await test.step('4. Exécution : Démarrer puis Compléter', async () => {
      await providerPage.goto('/dashboard?onglet=jobs');
      const job = cardWithTitle(providerPage, title);
      const started = bffPost(providerPage, /\/api\/service-requests\/[^/]+\/start$/);
      await job.getByRole('button', { name: 'Démarrer' }).click();
      expect((await started).ok(), 'POST …/start').toBe(true);

      const completed = bffPost(providerPage, /\/api\/service-requests\/[^/]+\/complete$/);
      await job.getByRole('button', { name: 'Compléter' }).click();
      expect((await completed).ok(), 'POST …/complete').toBe(true);
      assertGuards();
    });

    // ─── 5. Solde et webhook ────────────────────────────────────────────────
    await test.step('5. Solde confirmé par le client, demande « Payée » par le webhook', async () => {
      await clientPage.goto('/requests');
      const request = cardWithTitle(clientPage, title);
      await expect(request.getByText('Complétée', { exact: true })).toBeVisible();
      await expectTrialBanner(clientPage, 'Confirmer et verser');
      await request.getByRole('button', { name: 'Confirmer la fin des travaux' }).click();

      const dialog = clientPage.getByRole('dialog', { name: 'Confirmer la fin des travaux' });
      await expect(dialog).toBeVisible();
      const confirmed = bffPost(clientPage, /\/api\/service-requests\/[^/]+\/confirm-completion$/);
      await dialog.getByRole('button', { name: 'Confirmer et verser' }).click();
      const status = (await confirmed).status();
      if (status === 202) throw new Error('SOLDE NON RÉGLÉ (202) : le solde attend une confirmation du client.');
      expect(status, 'POST …/confirm-completion').toBe(200);
      await expect(request.getByText('Versement effectué')).toBeVisible();

      // Seul le webhook payment_intent.succeeded du solde fait passer la demande à PAID.
      try {
        await expect(async () => {
          await clientPage.reload();
          await expect(cardWithTitle(clientPage, title).getByText('Payée', { exact: true })).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: WEBHOOK_TIMEOUT_MS, intervals: [2_000, 5_000, 10_000] });
      } catch (error) {
        if (await cardWithTitle(clientPage, title).getByText('Complétée', { exact: true }).isVisible()) {
          throw new Error('WEBHOOK NON REÇU (la demande est restée Complétée)');
        }
        throw error;
      }
      assertGuards();
    });
  } finally {
    for (const [context, role] of contexts) await closeSession(context, role).catch(() => undefined);
  }
});
