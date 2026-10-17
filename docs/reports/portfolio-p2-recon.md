# Portfolio — P2 : reconnaissance (étape 0)

Branche `feat/portfolio-p2`, depuis `main` = `36244eb`. Lecture seule. **Aucune condition d'arrêt atteinte.**

## 1. Structure de l'Espace pro

- Page unique `apps/web/src/app/(app)/dashboard/page.tsx` (Server Component, `force-dynamic` de fait). Elle lit tout côté serveur avec `getServerApiClient()`, construit **un panneau par onglet** dans `panels: Record<DashboardTab, ReactNode>` et ne rend que l'actif.
- Barre d'onglets : `_components/dashboard-tabs.tsx` (Server Component, liens `?onglet=<slug>`). Ajouter un onglet = une entrée dans `DASHBOARD_TABS` + une entrée dans `COUNTER_LABELS` + un panneau + un compteur dans `page.tsx`. Ordre actuel **verrouillé** : En attente · Appels d'offres · Mes jobs · Mes métiers · Notifications · Avis. Le nouvel onglet se pose **en dernier** (`portfolio`), pour ne rien déplacer.
- Garde de rôle : `getCurrentUser()` → `redirect('/login')` ; `GET /service-providers/me` → 404 = `notPro` → `BecomeProviderCard`, **sans barre d'onglets**. Un panneau Portfolio hérite donc de ce comportement sans rien ajouter.
- Une lecture en échec garde son onglet **sans compteur** (`null`), et son panneau dit « Chargement impossible ». Même règle pour le portfolio.

## 2. Relais BFF qui envoient un fichier

- **Il n'en existe aucun.** `grep FormData|multipart|formData` dans `apps/web/src` : zéro résultat. Les pièces de vérification n'ont pas d'écran d'envoi (dette §6). P2 crée donc le premier relais multipart.
- Schéma des frères (`api/reviews/[id]/response`, `payment-methods`…) : `getServerApiClient()` → `client.<VERBE>(path, …)` → `NextResponse.json(error ?? data ?? null, { status })`, `204` sans corps, `catch` → `502`.
- openapi-fetch 0.17 accepte un `bodySerializer` par appel et laisse un `Content-Type` explicite écraser son défaut JSON. Le relais peut donc transmettre **les octets reçus tels quels** avec le `Content-Type` d'origine (frontière multipart comprise), sans reconstruire de `FormData` ni toucher à l'image. Le jeton passe par le middleware d'authentification du client, comme partout.
- Le 409 de l'API porte `code: PORTFOLIO_LIMIT_REACHED` (exception commentée « P2 maps on it ») : c'est l'exception voulue au mappage par statut seul (verrou 3.12b). Le relais transparent le transmet sans rien faire.

## 3. Taille du corps

- Un gestionnaire de route Next n'a **pas** de limite propre. La limite qui joue est celle du **proxy** (`proxy.ts` tourne sur `/api/*`) : `experimental.proxyClientMaxBodySize`, **10 Mo par défaut** (`config-shared.js`). Au-delà, le corps est **tronqué en silence**, sans erreur (doc `proxyClientMaxBodySize.md`).
- 5 Mo + l'enveloppe multipart tiennent largement : **aucune configuration nécessaire**. Le relais détecte quand même la troncature (octets reçus < `Content-Length` annoncé) et répond `413` au lieu de transmettre un corps coupé.
- `proxy.ts` ne lit jamais le corps (vérifié).
- Tunnel Cloudflared (`*.trycloudflare.com` → `:3001`) : même origine, l'envoi passe par `/api/…` comme le reste ; plafond du tunnel gratuit 100 Mo. `allowedDevOrigins` déjà en place.

## 4. Composants réutilisables

- `components/ui/confirm-dialog.tsx` (`<dialog>` natif, boutons 44 px) pour la suppression.
- Classes de champs, boutons (`min-h-11`), bandeaux `role="alert"` et région `aria-live` : celles de `_actions/service-row.tsx` / `add-service-form.tsx`, recopiées en constantes locales comme le font les frères. Pas de composant « champ avec compteur » existant : le compteur est écrit dans l'îlot.
- Patron `useTransition` + `router.refresh()` de `service-row.tsx` (évite d'afficher un succès au-dessus de données périmées).

## 5. Types et constantes

- `schema.d.ts` : `PortfolioItemListDto { items }`, `PortfolioItemDto { id, caption: string|null, position, width, height, imageUrl, createdAtUtc }`, `ReorderPortfolioDto { ids }`, `UpdatePortfolioCaptionDto { caption: string|null }`. **Aucun `Record<string, never>`** : consommés nativement, zéro miroir.
- Routes : `GET`/`POST /service-providers/me/portfolio`, `PUT …/order` (**200** avec la liste, pas 204), `PATCH`/`DELETE …/{itemId}` (204 pour le DELETE). Le POST est `multipart/form-data` `{ file, caption? }`.
- `lib/portfolio/portfolio-limits.ts` : `PORTFOLIO_MAX_ITEMS = 12`, `PORTFOLIO_MAX_BYTES = 5242880`, `PORTFOLIO_CAPTION_MAX = 140`, déjà sous la garde miroir.

## 6. Tests web

- `node --experimental-strip-types --test "src/**/*.test.mjs"` ; modules `.ts` **sans aucun import** (le job CI n'installe rien), tests `.mjs` qui les importent par chemin relatif. Les tests sur la source lisent les fichiers avec `readFileSync` (patron `portfolio-media.test.mjs`).
- P2 met toute la logique (contrôle avant envoi, traduction des erreurs, nouvel ordre, compteur, inspection du corps multipart) dans `lib/portfolio/portfolio-rules.ts`, pur.

## Écart au mandat, signalé

**Pas de relais `GET`.** Le mandat en demande un, mais le §13.1 nº 6 (décision verrouillée) réserve le BFF aux mutations : une lecture que la navigation peut porter passe par le Server Component. C'est le cas ici (après chaque mutation, `router.refresh()` relit la liste, et c'est aussi ce qui remet l'ordre du serveur après un échec). La liste est donc lue dans `page.tsx`, comme les six autres onglets. Quatre relais au lieu de cinq.
