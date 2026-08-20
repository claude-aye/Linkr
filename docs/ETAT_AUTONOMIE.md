# ÉTAT — Travail autonome CC

**Dernière session :** 2026-08-19 (session 8) · `main` @ `5bd81b3` · migration `1780510000000` (inchangée)

## Chantier en cours

**La file est SOLDÉE.** Les quatre décisions humaines sont appliquées (PR #78) : limitation de débit
réutilisable sur `POST /demand-signals`, invariants inscrits en `CLAUDE.md` §13.1, corollaire « des
recherches, jamais des personnes » porté à l'écran, amendement §3.9 porté au mandat.

**Prochain chantier : D — avis et évaluations.** Chantier lourd, **première vraie migration sous
autonomie**, brief humain attendu. C'est le seul de la file qui **ne se rattrape pas
rétroactivement** : chaque semaine sans avis est de la preuve sociale définitivement perdue sur les
transactions déjà faites.

## Découpage retenu

- [x] H tranche 1 — Entrée par métier depuis l'accueil + état vide honnête (PR #73, mergée)
- [x] Fixture métier réglementé vérifié (PR #74, mergée) — hors file, brief humain
- [x] Fermeture de l'entrée client réglementée + « Espace pro » (PR #75, mergée) — hors file, brief humain
- [x] H tranche 2a — Signal de demande anonyme (PR #76, mergée)
- [x] Lecture de la carte de la demande (PR #77, mergée) — hors file, brief humain
- [x] **Session 8 — solde de la file (PR #78, mergée)** — hors file, brief humain
- [ ] **D — avis et évaluations** ← **PROCHAINE**, chantier lourd, brief humain attendu
- [ ] H tranche 2b — « Prévenez-moi » (opt-in, consentement, seconde table) — **TOUJOURS BLOQUÉE** tant
      que le chantier courriels du collaborateur est en bac à sable. **Rien n'est amorcé, délibérément.**

**G-2 (cibles tactiles dans les pages) reste DÉPRIORISÉ** — à traiter **de façon opportuniste**, dans
la PR qui touchera de toute façon la page concernée.

Bande d'horodatage de migration : `1780510000000` → `1780599999999` (**`…510000000` est pris par #76** ;
**la prochaine migration prend `…520000000`** — ce sera vraisemblablement celle du chantier D. La bande
du collaborateur `…480/490` reste intouchable).

## Ce que la prochaine session doit savoir

1. **⚠️ LE LIMITEUR DE DÉBIT NE DÉDOUBLONNE PAS LES PERSONNES, ET RIEN NE LE PEUT.** Sans identité en
   base, une personne qui cherche dix fois **est** dix lignes. La menace résiduelle est le gonflement
   d'un secteur **réellement vide** par un compte authentifié : elle fausse **combien**, jamais **où**.
   La carte se lit comme une **direction**, pas comme une mesure d'audience — c'est écrit à l'écran et
   en §13.1 entrée 9.
2. **⚠️ LA CLÉ DU LIMITEUR EST L'APPELANT, JAMAIS L'APPELANT × CE QU'IL A CHERCHÉ.** Clé-t-on par
   appelant **et catégorie** — la « correction » qui paraît plus juste — qu'on reconstruit **en mémoire
   du processus** l'association que `demand_signals` refuse de tenir. L'anonymat est une propriété du
   **système entier**, pas d'un moteur de stockage.
3. **`common/rate-limit/` est réutilisable et attend son deuxième usager.** `@RateLimit({ limit,
   windowSeconds })` au site d'appel + `RateLimitGuard` en **provider local du module** (convention
   `AdminGuard`). Une route **non décorée est inerte**. Le budget vit **au site d'appel, pas dans
   l'environnement** : deux routes ont des trafics honnêtes différents. **⚠️ Le jour du `discover`
   public** : `main.ts` ne pose **aucun `trust proxy`**, donc `request.ip` est le pair TCP — derrière un
   répartiteur, **tous les anonymes partageraient un seul budget**. L'activer fait partie de
   l'exposition de la route.
4. **⚠️ DEUX LIMITEURS, DEUX PROBLÈMES OPPOSÉS — ne pas les confondre ni les fusionner.**
   `common/geocoding/rate-limited-geocoding.service.ts` est un cap **sortant** (1 req/s vers Nominatim,
   politesse envers un tiers, décorateur de port). `common/rate-limit/` est un cap **entrant** par
   appelant (abus). Les deux sont **en mémoire**, pour des raisons différentes mais convergentes : un
   limiteur adossé à Redis doit choisir entre échouer ouvert (aucune protection sous tension) et
   échouer fermé (route morte sur panne de cache). **Contrepartie commune, qui se dégrade en SILENCE :
   le compte est par processus** ; répliquer l'API multiplie les budgets sans erreur ni log. La sortie
   est un compteur partagé, **jamais une constante plus petite**.
5. **L'amendement §3.9 est actif** : tu peux **AJOUTER** une entrée `CLAUDE.md` §13.1 quand la décision
   humaine est écrite **mot pour mot** dans ce fichier. Tu portes le texte, tu ne le reformules pas, et
   toute note de portage est **signalée hors du texte porté**. **Modifier ou supprimer** une entrée
   existante reste un arrêt dur. Première application : entrées **8** et **9** (PR #78).
6. **⚠️ `AT TIME ZONE 'UTC'` est porteur aux DEUX bouts.** Côté SQL, un `date_trunc` nu suit le
   `TimeZone` de session. Côté front, `new Date('2026-08-19')` se parse en **minuit UTC** : un
   formateur `fr-CA` sans `timeZone: 'UTC'` afficherait **la veille**.
7. **Le contrat propre en amont paie immédiatement.** `@ApiProperty` à **type concret** +
   `additionalProperties` sur les maps i18n → **zéro `Record<string, never>`**, donc zéro miroir et zéro
   cast côté front. Quatrième fois que ça marche.
8. **⚠️ PIÈGE `grep` SUR `ps`, il a mordu DEUX fois.** `grep "[p]roxy"` a tué mon propre shell : la
   ligne de commande contenait `--noproxy '*'`. **Écrire le PID dans un fichier au lancement**
   (`nohup … & echo $! > x.pid`) et tuer **par ce PID**. `ss -ltnp` ne montre aucun PID ici.
9. **Après un rebuild web, tuer explicitement l'ancien `next-server`** — sinon il reste lié au port et
   le nouveau `next start` meurt en silence (« Failed to start server »), servant l'ancienne page. Ça
   m'a fait croire qu'un correctif n'avait pas pris.
10. **Montage de la stack** : Docker **absent** ; **le bac à sable a PERSISTÉ entre les sessions 7 et 8**
    (base `linkr` déjà là, 11 signaux, 3 users dont l'ADMIN) — ne pas présumer une base neuve, la
    **sonder**. Sinon : `apt-get update` **d'abord**, `postgresql-16-postgis-3`, rôle `linkr` SUPERUSER,
    `CREATE EXTENSION postgis`, `pnpm install` (**les `node_modules` des workspaces manquent au
    départ**), `migration:run`, seed Québec. Table des migrations = **`typeorm_migrations`**.
    `npm install playwright-core` dans le scratchpad, Chromium en `executablePath` + `--no-sandbox`.
11. **Ma base n'est pas celle de l'humain.** Elle porte désormais **31 signaux** dont 20 écrits par le
    smoke du limiteur (secteur `50.10 / -66.10`, sans valeur métier) ; **celle de l'humain porte 1
    ligne** (esthétique, `48.45 / -68.53`).
12. **⚠️ MON ÉTAT `git` DISTANT N'EST PAS UNE MESURE.** Deux faux rapports au compteur (session 6 : diff
    périmé sans `--prune` ; session 7 : branche signalée non supprimée alors que
    `delete_branch_on_merge` l'avait retirée). **Le dépôt supprime les branches automatiquement — ne
    plus jamais signaler de reliquat de branche.** *Note session 8 : `git fetch`/`checkout` ont
    fonctionné normalement cette fois ; seul `git push --delete` avait été bloqué en session 7.*
13. **`MANDAT_01_fixtures.md` toujours pas entamé.** `dev-fixtures.seed.ts` et le câblage
    `seed:catalog`/`seed:dev` sont **assignés au collaborateur** — ne pas les préempter.
14. **Rappels toujours valables** : écrire `ETAT`/`JOURNAL` sur `main` **via l'API GitHub** · ne jamais
    lancer Prettier sur `apps/web` · **`ASSIGNED` reste inatteignable** faute d'onboarding Stripe
    Connect (`assertPayable` **409** avant tout appel à Stripe) → dette « `JobCard` jamais smoké »
    **toujours ouverte**, et elle croisera le chantier D (un avis suppose une transaction terminée).

## ⛔ En attente de décision humaine

**AUCUNE. La file est vide, et elle a été soldée par la PR #78.**

Les quatre décisions de la session 7 sont **appliquées** : ⛔① (verrou `REJECTED`) reste **délibérément
différée au chantier réglementé** — son seul chemin d'accès est l'expiration d'un document de licence,
impossible tant que le MVP se lance en métiers informels ; ⛔② close par conception ; ⛔③ inscrite en
§13.1 (entrées 8 et 9) ; ⛔④ livrée.

## Dettes créées par la dernière PR

**Aucune.** La PR #78 en **solde une** (limitation de débit) et n'en crée pas.

**Contreparties assumées et écrites** (pas des dettes, des propriétés connues) : le compte du limiteur
est **par processus** (réplication ⇒ budgets multipliés, silencieusement) · **fenêtre fixe** ⇒ jusqu'à
2 × `limit` à la couture entre deux fenêtres · **`trust proxy` absent**, à activer le jour du `discover`
public.

**Relevées, inchangées** : aucun index des consoles admin (`/admin/verifications` et
`/admin/demand-signals` s'atteignent par URL seulement) · `locality` au géocodage — **la vraie réponse
au « où » lisible** · le foyer *feature toggling* · les 5 occurrences restantes de « tableau de bord » ·
`body { font-family: Arial… }` dans `globals.css` écrase les polices Geist (PR dédiée) · aucune
vérification en **mode sombre** nulle part · les deux liens en ligne à 16 px de #73 · cibles tactiles
**dans les pages** non auditées (G-2, déprioritisé) · notifications prestataire ORGANIZATION illisibles ·
`docker/data/` tracké par git · verrou du refus `REJECTED` (⛔①, différé au chantier réglementé).
