import { expect, type BrowserContext, type Frame, type Page, type Request } from '@playwright/test';

/**
 * Garde-fous du parcours de paiement. NE JAMAIS LES ASSOUPLIR (voir CLAUDE.md).
 *
 * Aucun d'eux ne lit ni n'écrit une clé Stripe : la suite n'en connaît aucune.
 * Elle ne fait que REFUSER ce qui en porterait une de production.
 */

/**
 * LA seule carte que ce parcours saisit : la carte de test Visa de Stripe, sans
 * 3D Secure. Littérale, jamais lue d'une variable d'environnement.
 */
export const TEST_CARD_NUMBER = '4242424242424242';

/** Vérifie, juste avant la saisie, que le numéro est bien la carte de test. */
export function assertTestCard(cardNumber: string): void {
  if (cardNumber !== '4242424242424242') {
    throw new Error('GARDE-FOU : seule la carte de test 4242 4242 4242 4242 peut être saisie par ce parcours.');
  }
}

/**
 * Bandeau du layout racine : « Version d'essai · Paiements en mode test » (téléphone)
 * ou « Version d'essai · Les paiements sont en mode test : … » (ordinateur). Les deux
 * sont dans le DOM, un seul est visible selon la largeur.
 */
const TRIAL_BANNER = /Version d.essai\s*·\s*(?:Les paiements sont|Paiements) en mode test/;

/** À appeler avant l'ajout de la carte, avant « Accepter » et avant « Confirmer et verser ». */
export async function expectTrialBanner(page: Page, before: string): Promise<void> {
  await expect(
    page.getByText(TRIAL_BANNER).filter({ visible: true }).first(),
    `GARDE-FOU : bandeau « Version d’essai · … en mode test » absent avant « ${before} ». Aucune action de paiement sans lui.`,
  ).toBeVisible();
}

export interface PaymentGuards {
  /** Échoue si un garde-fou a été déclenché depuis l'installation. */
  assertClean(): void;
}

function pageOf(request: Request): Page | null {
  try {
    return request.frame().page();
  } catch {
    return null;
  }
}

/**
 * Installe sur le contexte :
 * 1. une route sur https://api.stripe.com/** qui BLOQUE (abort) toute requête portant
 *    une clé publiable de production (`pk_live_`, dans l'URL, le corps ou un en-tête),
 *    puis ferme la page avec le motif : l'action en cours échoue immédiatement ;
 * 2. une garde `framenavigated` : si le cadre PRINCIPAL quitte l'origine de
 *    E2E_BASE_URL, la page est fermée avec le motif. Les iframes Stripe (cadres
 *    enfants) ne sont pas concernées.
 * Le motif ne contient jamais la valeur de la clé ni le corps de la requête.
 */
export async function installPaymentGuards(context: BrowserContext, baseOrigin: string): Promise<PaymentGuards> {
  const violations: string[] = [];
  const trip = (page: Page | null, message: string) => {
    violations.push(message);
    void page?.close({ reason: message }).catch(() => undefined);
  };

  await context.route('https://api.stripe.com/**', async (route) => {
    const request = route.request();
    const headers = Object.values(await request.allHeaders()).join('\n');
    const haystack = `${request.url()}\n${request.postData() ?? ''}\n${headers}`;
    if (haystack.includes('pk_live_')) {
      await route.abort('blockedbyclient');
      trip(
        pageOf(request),
        'GARDE-FOU : une requête vers api.stripe.com porte une clé publiable de PRODUCTION (pk_live_). ' +
          'Requête bloquée, parcours arrêté.',
      );
      return;
    }
    await route.continue();
  });

  const watch = (page: Page) => {
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      if (url === 'about:blank') return;
      let origin = '';
      try {
        origin = new URL(url).origin;
      } catch {
        origin = url;
      }
      if (origin !== baseOrigin) {
        trip(page, `GARDE-FOU : le cadre principal a quitté ${baseOrigin} (vers ${origin}). Parcours arrêté.`);
      }
    });
  };
  context.pages().forEach(watch);
  context.on('page', watch);

  return {
    assertClean() {
      if (violations.length > 0) throw new Error(violations.join(' | '));
    },
  };
}

/**
 * Attend la réponse de Stripe à la confirmation du SetupIntent et exige
 * `livemode === false`. C'est la preuve du mode test côté serveur : le SetupIntent
 * est créé par la clé secrète de l'API, et Stripe refuse qu'une clé publiable de
 * test confirme un SetupIntent créé en mode réel. À armer AVANT le clic.
 */
export function expectTestModeSetupConfirm(context: BrowserContext): Promise<void> {
  return context
    .waitForEvent('response', {
      predicate: (response) => /^https:\/\/api\.stripe\.com\/v1\/setup_intents\/[^/]+\/confirm/.test(response.url()),
      timeout: 60_000,
    })
    .then(async (response) => {
      expect(response.status(), 'Stripe doit accepter la confirmation du SetupIntent').toBe(200);
      // Seul ce champ est lu : le reste de la réponse n'est ni journalisé ni comparé.
      const { livemode } = (await response.json()) as { livemode?: unknown };
      expect(livemode, 'GARDE-FOU : le SetupIntent confirmé doit être en mode test (livemode === false)').toBe(false);
    });
}

/**
 * Le cadre du PaymentElement : celui, parmi les iframes Stripe, qui contient le
 * champ du numéro de carte. Repéré par son CONTENU (`input[name="number"]`) et non
 * par son titre (localisé) ni par le chemin exact de son URL (interne à Stripe).
 */
export async function cardFrame(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          if (!frame.url().startsWith('https://js.stripe.com/')) continue;
          if ((await frame.locator('input[name="number"]').count().catch(() => 0)) > 0) {
            found = frame;
            return true;
          }
        }
        return false;
      },
      { message: 'Le formulaire de carte Stripe (PaymentElement) ne s’est pas affiché', timeout: 30_000 },
    )
    .toBe(true);
  return found!;
}

/** Saisit la carte de test dans le PaymentElement (pays Canada, code postal de Québec). */
export async function typeTestCard(frame: Frame, cardNumber: string): Promise<void> {
  assertTestCard(cardNumber);
  const expiryYear = (new Date().getUTCFullYear() + 3) % 100;
  const number = frame.locator('input[name="number"]');
  await number.pressSequentially(cardNumber);
  expect((await number.inputValue()).replace(/\D/g, ''), 'Numéro saisi = carte de test').toBe(TEST_CARD_NUMBER);
  await frame.locator('input[name="expiry"]').pressSequentially(`12${String(expiryYear).padStart(2, '0')}`);
  await frame.locator('input[name="cvc"]').pressSequentially('123');
  const country = frame.locator('select[name="country"]');
  if (await country.count()) await country.selectOption('CA');
  const postal = frame.locator('input[name="postalCode"]');
  if (await postal.count()) await postal.fill('G1R 4P5');
}

/** Montant fr-CA tel que l'interface l'affiche (« 40,00 $ »), espaces normalisées. */
const MONEY = /\d{1,3}(?: \d{3})*,\d{2} ?\$/;

export function moneyIn(text: string | null): string | null {
  const match = (text ?? '').replace(/\s+/g, ' ').match(MONEY);
  return match ? match[0] : null;
}

/** Titre de la demande, repère de purge : e2e-paiement-aaaammjjThhmmZ (UTC). */
export function paymentRequestTitle(now = new Date()): string {
  const iso = now.toISOString(); // 2026-11-04T15:32:10.000Z
  return `e2e-paiement-${iso.slice(0, 10).replaceAll('-', '')}T${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
}

export const PAYMENT_TITLE_PATTERN = /e2e-paiement-\d{8}T\d{4}Z/;

/**
 * Fenêtre souhaitée : début = maintenant + 3 h arrondi au quart d'heure SUIVANT,
 * fin = début + 2 h. Valeurs `datetime-local` en UTC (le navigateur de la suite est
 * en `timezoneId: 'UTC'`, donc l'heure saisie EST l'heure UTC).
 */
export function desiredWindow(now = new Date()): { start: string; end: string } {
  const quarter = 15 * 60_000;
  const start = new Date(Math.ceil((now.getTime() + 3 * 3_600_000) / quarter) * quarter);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  return { start: start.toISOString().slice(0, 16), end: end.toISOString().slice(0, 16) };
}
