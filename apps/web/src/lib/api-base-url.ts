/**
 * Adresse de l'API pour les appels faits côté serveur (relais BFF, Server
 * Components, rafraîchissement de session). Aucun import, pour que
 * `node --test` le charge tel quel.
 *
 * Le repli sur `localhost:5000` n'existe qu'en développement. En production,
 * une variable absente est une erreur franche : un repli silencieux enverrait
 * chaque appel vers une adresse qui ne répond pas, avec des symptômes
 * (connexion impossible, 502) qui ne nomment jamais la cause. Les modules qui
 * l'appellent le font au chargement, donc `next build` échoue avant tout
 * déploiement.
 */
export const DEV_API_BASE_URL = 'http://localhost:5000';

export function resolveApiBaseUrl(
  value: string | undefined,
  nodeEnv: string | undefined,
): string {
  if (value !== undefined && value.trim() !== '') return value;
  if (nodeEnv === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_URL is required in production (no localhost fallback). ' +
        'Set it before `next build`: it is inlined at build time.',
    );
  }
  return DEV_API_BASE_URL;
}
