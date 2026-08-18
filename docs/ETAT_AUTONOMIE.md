# ÉTAT — Travail autonome CC

**Dernière session :** 2026-08-18 (session 6) · `main` @ `99a9c64` · migration `1780500000000`
**⚠️ PR #76 OUVERTE, NON MERGÉE — porte humaine (migration `1780510000000`).**

## Chantier en cours

**H tranche 2a — signal de demande anonyme (PR #76, ouverte).** Le travail est **fait, prouvé et poussé** ;
il attend le rejeu de `migration:run` / `migration:revert` sur la **vraie** base de développement, celle qui
porte les lignes historiques et les `SONDE-*`/`SMOKE-*`. **Ne pas refaire cette tranche** : lire la PR d'abord.

## Découpage retenu

- [x] H tranche 1 — Entrée par métier depuis l'accueil + état vide honnête (PR #73, mergée)
- [x] Fixture métier réglementé vérifié (PR #74, mergée) — hors file, brief humain
- [x] Fermeture de l'entrée client réglementée + « Espace pro » (PR #75, mergée) — hors file, brief humain
- [~] **H tranche 2a — Signal de demande anonyme (PR #76, OUVERTE — porte humaine)**
- [ ] H tranche 2b — « Prévenez-moi » (opt-in, consentement, seconde table) ← **BLOQUÉE** tant que le
      chantier courriels du collaborateur est en bac à sable : promettre un rappel qu'on ne peut pas
      envoyer est une dette envers l'utilisateur. **Rien n'est amorcé, délibérément.**

Ensuite : **G-2** (cibles tactiles **dans les pages** — « Voir le détail → » mesuré à 16 px sur le tableau
de bord, non corrigé), puis **D — avis et évaluations**.
Bande d'horodatage de migration : `1780510000000` → `1780599999999` (**`…510000000` est désormais pris par
la PR #76** ; la bande du collaborateur `…480/490` reste intouchable).

## Ce que la prochaine session doit savoir

1. **⚠️ PR #76 N'EST PAS MERGÉE. Avant toute chose : vérifier son état.** Si elle est mergée, la tête de
   migration est `1780510000000` et `demand_signals` existe. Si elle est encore ouverte, **ne pas la
   refaire et ne pas empiler dessus** — une nouvelle migration prendrait `…520000000` et créerait un
   ordre douteux si #76 était rejetée.
2. **⚠️ L'INVARIANT DE LA PR #76, ET IL RESSEMBLE À UN OUBLI : `demand_signals` NE PORTE AUCUN
   IDENTIFIANT.** Pas de `user_id` même nullable, pas de FK vers `users`, pas d'IP, pas d'empreinte de
   session — et **pas de `deleted_at_utc` ni d'`updated_at_utc`**. C'est **la** propriété qui garde ces
   lignes hors du champ des renseignements personnels, donc qui permet de les conserver **sans horloge
   de rétention**. Ajouter une colonne propriétaire « tant qu'à y être » détruirait ça **sans aucun
   symptôme**. Idem pour l'arrondi : `numeric(_,2)` est **porteur**, pas cosmétique. La protection vit
   dans le `COMMENT ON TABLE`, les commentaires d'entité et l'entrée `CLAUDE.md` §11 — **pas** dans
   §13.1, parce que modifier §13.1 est un arrêt dur (⛔③).
3. **⚠️ `migration:generate` M'A RATTRAPÉ SUR UNE VRAIE DÉRIVE — le lancer fait partie du travail.**
   Sans miroirs d'entité, il proposait un `up()` qui **supprimait l'index, les deux CHECK et le
   commentaire de table** de ma table neuve (les commentaires de **colonne**, déjà miroités, étaient
   épargnés). Règle générale : **tout ce qu'une migration installe et que TypeORM ne déduit pas d'une
   colonne simple doit être redit sur l'entité** (`@Index`, `@Check`, `comment`). Le renommage de FK
   qu'il propose en plus est le **bruit connu** du dépôt, pré-existant.
4. **⚠️ `git diff origin/main` M'A MENTI AU DÉPART — `--prune` n'est pas optionnel.** `origin/main` était
   périmé à `e667737` et le diff affichait ~29 fichiers au lieu de 15. Symptôme **silencieux**, exactement
   le cas du mandat §4. Toujours `git fetch origin --prune` **avant** de regarder un diff de périmètre.
5. **⚠️ `pkill -f "<motif large>"` TUE MON PROPRE SHELL** (exit 144) : la ligne de commande de l'agent
   contient l'intégralité du prompt système, donc à peu près n'importe quel motif y matche. **Utiliser des
   PID explicites** (`ss -ltnp | grep ':5000 ' | grep -oP 'pid=\K[0-9]+'`). Rappel session 5 toujours
   valable : `next-server` est le vrai nom du processus web.
6. **Montage de la stack, inchangé et toujours coûteux** : Docker **absent** ; Postgres 16 présent mais
   **PostGIS ABSENT** → `apt-get update` **d'abord** (sinon 404), puis `postgresql-16-postgis-3`, rôle
   `linkr` SUPERUSER, base, `CREATE EXTENSION postgis`, `migration:run`, seed Québec. Le navigateur
   Chromium est là (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) mais **`playwright` n'est pas
   installé** : `npm install playwright-core` dans `/tmp` et lancer avec `executablePath` + `--no-sandbox`.
7. **Le proxy d'injection de faute reste le meilleur outil pour prouver un rouge** — 15 lignes, `500` sur
   **une seule** route. Piège découvert : `NEXT_PUBLIC_API_URL` est **inliné au build**, donc on ne
   repointe pas le web sans rebuild. **Plus rapide : déplacer l'API** (`PORT=5001`) et mettre le proxy
   sur `:5000`. Toujours poser un **contrôle** montrant que la route qu'on observe est joignable, sinon un
   compte inchangé ne prouve rien.
8. **Ma base n'est pas celle de l'humain** — elle repart de zéro à chaque session. Les UUID de catalogue
   que je publie ne valent que pour la mienne.
9. **`MANDAT_01_fixtures.md` toujours pas entamé.** `dev-fixtures.seed.ts` et le câblage
   `seed:catalog`/`seed:dev` sont **assignés au collaborateur** — ne pas les préempter.
10. **Rappels toujours valables** : le blocage `git` est **la branche, pas la commande** (rester sur sa
    branche, écrire `ETAT`/`JOURNAL` sur `main` **via l'API GitHub**) · ne jamais lancer Prettier sur
    `apps/web` · **`ASSIGNED` reste inatteignable** faute d'onboarding Stripe Connect (`assertPayable`
    **409** avant tout appel à Stripe) → dette « `JobCard` jamais smoké » **toujours ouverte**.

## ⛔ En attente de décision humaine

**① Un refus verrouille le métier à vie — inchangé depuis la session 4, rien touché.**
`ux_psc_provider_category_active` est unique sur `(service_provider_id, service_category_id)
WHERE deleted_at_utc IS NULL` et **n'inclut pas `verification_status`** ; `existsActive()` copie ce
prédicat. Un prestataire passé `REJECTED` **ne peut plus jamais re-revendiquer ce métier** : **409** propre
et sans issue. Le chemin qui produit un `REJECTED` fonctionne (expiration de document → rétrogradation,
mesuré), donc le verrou est atteignable **dès le premier document expiré**.
- **Option recommandée : ouvrir une transition `REJECTED → PENDING`** sur la ligne existante. Elle **ne
  touche pas à l'index**, donc évite l'arrêt dur §3, et conserve l'historique.

**② Conservation d'une recherche restée vide — CLOSE, et pas par un chiffre.**
La question supposait une collecte auprès de **non-utilisateurs**. C'est faux : `/recherche` est **privée**
(anonyme → **307 → `/login`**), donc tout chercheur est déjà authentifié et déjà en base. La PR #76 tranche
**par la conception** : la table ne porte **aucun lien** vers une personne, donc une ligne n'est pas un
renseignement personnel, donc il n'y a **ni durée à arbitrer, ni purge à écrire**. Conservation illimitée du
signal agrégé — **tenue uniquement par cette absence**. *Aucune action requise.*

**③ Faut-il inscrire des invariants dans `CLAUDE.md` §13.1 ? — élargie par la session 6.**
Modifier §13.1 est sur la liste d'arrêt (mandat §3.9), donc je ne l'ai pas fait. **Deux** candidats
maintenant, tous deux du profil « le code ressemble à un oubli, le corriger casse tout sans symptôme » :
- **(a)** « offert ≠ résolvable » → `lib/catalog/launch-scope.ts` + commentaire de `recherche/page.tsx`.
- **(b) NOUVEAU** « `demand_signals` ne porte aucun identifiant, et l'arrondi `numeric(_,2)` est porteur »
  → migration `1780510000000` + entité.
- **Option recommandée : oui, ajouter les deux**, en entrées courtes renvoyant au code. En attendant, la
  protection ne vit que dans les commentaires et l'entrée §11.

## Dettes créées par la dernière PR

**Trois, écrites dans `CLAUDE.md` §6** (PR #76) : (1) **la carte de la demande est écrite mais ILLISIBLE** —
aucune route, aucun écran ne l'expose, c'est le prochain maillon ; (2) **aucune limitation de débit** sur
`POST /demand-signals` — la vérification serveur empêche d'inventer un métier ou un secteur **non vides**,
pas de **gonfler** le compte d'un secteur réellement vide ; à traiter avec le chantier « rendre `discover`
public + limitation de débit » ; (3) **le secteur est un arrondi de coordonnée faute de mieux** — le
correctif long terme est la `locality` capturée au géocodage (dette §6 déjà tracée, explicitement reliée).

**Ligne de `JOURNAL_AUTONOMIE.md` : DUE AU MERGE de #76**, pas avant — le journal enregistre ce qui a
changé sur `main`, et rien n'y a changé tant que la PR est ouverte.

**Relevées, inchangées** : le foyer *feature toggling* · les 5 occurrences restantes de « tableau de bord » ·
`body { font-family: Arial… }` dans `globals.css` écrase les polices Geist (PR dédiée) · aucune vérification
en **mode sombre** nulle part · les deux liens en ligne à 16 px de #73 · cibles tactiles **dans les pages**
non auditées (G-2) · notifications prestataire ORGANIZATION illisibles · `docker/data/` tracké par git.
