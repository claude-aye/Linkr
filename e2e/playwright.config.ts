import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Charge e2e/.env.e2e s'il existe ; une variable déjà posée dans l'environnement l'emporte.
const envFile = path.join(__dirname, '.env.e2e');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const baseURL = (process.env.E2E_BASE_URL ?? '').trim().replace(/\/+$/, '');
if (!baseURL) {
  throw new Error(
    'E2E_BASE_URL est obligatoire (aucune valeur par défaut, pour ne jamais viser un site par accident). ' +
      'Renseignez-la dans e2e/.env.e2e ou dans l’environnement.',
  );
}
try {
  new URL(baseURL);
} catch {
  throw new Error('E2E_BASE_URL n’est pas une URL valide (ex. https://exemple.ca).');
}

export default defineConfig({
  testDir: './tests',
  // Un seul fichier, des parcours qui se suivent (le prestataire de B sert à E).
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    locale: 'fr-CA',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
