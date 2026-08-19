# ÉTAT — Travail autonome CC

**Dernière session :** 2026-08-19 (session 7) · `main` @ `1cbe6ab` · migration `1780510000000` (inchangée)

## Chantier en cours

**H tranche 2a — SOLDÉE.** La carte de la demande est **écrite** (PR #76, session 6) **et lisible**
(PR #77, session 7 : `GET /admin/demand-signals` agrégé + écran `/admin/demand-signals`, ADMIN seul).

**Session 8 — SOLDE DE LA FILE.** Les quatre décisions humaines sont **tranchées** (section ⛔ ci-dessous).
La session 8 les applique : limitation de débit sur `POST /demand-signals` + les **trois** entrées §13.1.
Ensuite : **D — avis et évaluations**.

## Découpage retenu

- [x] H tranche 1 — Entrée par métier depuis l'accueil + état vide honnête (PR #73, mergée)
- [x] Fixture métier réglementé vérifié (PR #74, mergée) — hors file, brief humain
- [x] Fermeture de l'entrée client réglementée + « Espace pro » (PR #75, mergée) — hors file, brief humain
- [x] H tranche 2a — Signal de demande anonyme (PR #76, mergée)
- [x] Lecture de la carte de la demande (PR #77, mergée) — hors file, brief humain
- [ ] **Session 8 — solde de la file** ← **PROCHAINE** (voir ⛔)
- [ ] **D — avis et évaluations** — chantier lourd, brief humain à venir
- [ ] H tranche 2b — « Prévenez-moi » (opt-in, consentement, seconde table) — **TOUJOURS BLOQUÉE** tant que
      le chantier courriels du collaborateur est en bac à sable. **Rien n'est amorcé, délibérément.**

**G-2 (cibles tactiles dans les pages) est DÉPRIORISÉ** — plus une file dédiée. À traiter **de façon
opportuniste**, dans la PR qui touchera de toute façon la page concernée. Rien ne le bloque, rien ne le
presse ; D, lui, ne se rattrape pas rétroactivement.

Bande d'horodatage de migration : `1780510000000` → `1780599999999` (**`…510000000` est pris par #76** ;
la prochaine migration prend `…520000000`. La bande du collaborateur `…480/490` reste intouchable).

## Ce que la prochaine session doit savoir

1. **⚠️ LA MENACE DE VIE PRIVÉE DE `demand_signals` A CHANGÉ DE CAMP — elle vit désormais dans la LECTURE.**
   La session 6 a rendu l'anonymat **structurel** (aucune colonne d'identité) ; la session 7 a montré que
   **la couche de lecture peut le défaire sans toucher au schéma**. `created_at_utc` est précis **à la
   microseconde** (mesuré : `17:16:57.143627+00`) : servi à côté d'un métier, c'est une **clé de
   corrélation**. D'où trois invariants, tous dans `demand-signals.repository.ts` et le DTO : **`GROUP BY`
   en SQL** (jamais un `SELECT *` regroupé en JS), **période tronquée au jour** (`AT TIME ZONE 'UTC'`),
   **aucune méthode ne rend une ligne individuelle**. Ajouter un `findAll()` « pour déboguer » annulerait
   la session 6 **sans un seul symptôme**. → **désormais verrouillé en §13.1, cf. ⛔③.**
2. **⚠️ `AT TIME ZONE 'UTC'` est porteur aux DEUX bouts.** Côté SQL, un `date_trunc` nu suit le `TimeZone`
   de session et fait dériver le jour. Côté front, `new Date('2026-08-19')` se parse en **minuit UTC** :
   un formateur `fr-CA` sans `timeZone: 'UTC'` afficherait **la veille**. Les deux sont épinglés, et le
   disent en commentaire.
3. **Le contrat propre en amont paie immédiatement.** `@ApiProperty` à **type concret** sur chaque
   propriété + `additionalProperties` sur la map i18n → **zéro `Record<string, never>`** dans le généré,
   donc **zéro miroir et zéro cast** côté front. Troisième fois que ça marche (notifications PR B,
   `demand-signals` #76, #77). Les trois voisins que le dépôt contourne encore (`discover`,
   `GET /service-categories`, items de `…/service-requests`) sont des **omissions historiques**, pas une
   fatalité.
4. **⚠️ PIÈGE `pkill`/`grep`, variante de la note session 6.** Un `for p in $(ps … | grep "[p]roxy" …)`
   a **tué mon propre shell** : la ligne de commande contenait `--noproxy '*'`, donc elle matchait le motif.
   **Écrire le PID dans un fichier au lancement** (`nohup … & echo $! > x.pid`) et tuer **par ce PID**.
   Et `ss -ltnp` **ne montre aucun PID** dans ce bac à sable — utiliser `ps -eo pid,args`.
5. **`NEXT_PUBLIC_API_URL` est inliné au build : redémarrer le web ne suffit pas, il faut REBUILD** — et
   après un rebuild, **tuer explicitement l'ancien `next-server`**, sinon il reste lié au port et le
   nouveau `next start` meurt en silence (« Failed to start server » dans son log, page ancienne servie).
   Ça m'a fait croire une fois qu'un correctif n'avait pas pris.
6. **Montage de la stack, inchangé** : Docker **absent** ; Postgres 16 présent, **PostGIS ABSENT** →
   `apt-get update` **d'abord**, puis `postgresql-16-postgis-3`, rôle `linkr` SUPERUSER, base,
   `CREATE EXTENSION postgis`, `pnpm install` (**les `node_modules` des workspaces manquent au départ** —
   `migration:run` échoue sinon), `migration:run`, seed Québec. Table des migrations = **`typeorm_migrations`**,
   pas `migrations`. Chromium présent, `playwright` non installé → `npm install playwright-core` dans le
   scratchpad, lancer avec `executablePath` + `--no-sandbox`.
7. **Le proxy d'injection de faute reste le meilleur outil pour prouver un rouge** : déplacer l'API sur
   `:5001`, proxy sur `:5000` qui 500 **une seule** route. **Toujours poser un contrôle** montrant qu'une
   autre route passe encore, sinon un écran vide ne prouve rien.
8. **Ma base n'est pas celle de l'humain** — elle repart de zéro à chaque session. Les 11 signaux et les
   UUID de catalogue que je publie ne valent que pour la mienne ; **celle de l'humain porte 1 ligne**
   (esthétique, `48.45 / -68.53`, écrite par un vrai parcours navigateur, métier vérifié `INFORMAL`).
9. **⚠️ NOUVEAU — MON ÉTAT `git` VU DEPUIS LE BAC À SABLE N'EST PAS FIABLE.** Deux fois maintenant j'ai
   rapporté un état distant faux : session 6, un `git diff origin/main` périmé montrait 29 fichiers au lieu
   de 15 (réglé par `--prune`) ; session 7, j'ai signalé la branche `claude/lecture-carte-demande-p8t45y`
   comme non supprimée alors que **`delete_branch_on_merge` l'avait déjà retirée** — l'humain a reçu
   `remote ref does not exist`. **Le réglage du dépôt supprime les branches automatiquement : ne plus
   signaler de reliquat de branche, et ne jamais présenter un état `git` distant comme une mesure.**
10. **`MANDAT_01_fixtures.md` toujours pas entamé.** `dev-fixtures.seed.ts` et le câblage
    `seed:catalog`/`seed:dev` sont **assignés au collaborateur** — ne pas les préempter.
11. **Rappels toujours valables** : le blocage `git` est **la branche, pas la commande** (rester sur sa
    branche, écrire `ETAT`/`JOURNAL` sur `main` **via l'API GitHub**) · ne jamais lancer Prettier sur
    `apps/web` · **`ASSIGNED` reste inatteignable** faute d'onboarding Stripe Connect (`assertPayable`
    **409** avant tout appel à Stripe) → dette « `JobCard` jamais smoké » **toujours ouverte**.

## ⛔ En attente de décision humaine

**AUCUNE. La file est vide.** Les quatre entrées ci-dessous sont **tranchées** et conservées comme
enregistrement de la décision, pas comme attente.

---

**① Un refus verrouille le métier à vie — TRANCHÉ : correctif adopté, construction DIFFÉRÉE.**

L'option recommandée est retenue : **ouvrir une transition `REJECTED → PENDING`** sur la ligne existante.
Elle ne touche pas à `ux_psc_provider_category_active`, donc évite l'arrêt dur §3, et conserve l'historique.
**Ne pas modifier l'index unique.**

**Construction différée au chantier réglementé**, et pour une raison mesurée, pas par confort : le **seul**
chemin qui produit un `REJECTED` est l'expiration d'un document de licence. Or le MVP se lance en métiers
**informels** (session 5), qui passent en `NOT_REQUIRED` sans document — donc sans expiration possible.
Le verrou est **inatteignable en production tant que le segment réglementé reste fermé**. Il redevient
critique **le jour de sa réouverture** : ce correctif fait partie de ce chantier, pas d'une PR isolée.

---

**② Conservation d'une recherche restée vide — CLOSE (session 6), aucune action.**

La table ne porte **aucun lien** vers une personne, donc une ligne n'est pas un renseignement personnel,
donc il n'y a **ni durée à arbitrer, ni purge à écrire**. La session 7 n'y change rien : la lecture est
agrégée et tronquée au jour, elle n'introduit aucun nouveau champ conservé.

---

**③ Invariants en `CLAUDE.md` §13.1 — TRANCHÉ : oui, les TROIS.**

**(a) « offert ≠ résolvable »** → `lib/catalog/launch-scope.ts` + le commentaire au point de dérivation
de `recherche/page.tsx`. *L'encadré §11 de la session 5 le documente déjà très bien, mais §11 est un
**journal de phases** et §13.1 la section qu'on relit pour savoir ce qu'on n'a pas le droit de « réparer ».
Les deux ont leur place ; l'entrée §13.1 peut être courte et renvoyer au §11.*

**(b) + (c) — une seule entrée, sur les DEUX couches.** Texte de la décision, à porter tel quel :

> L'absence d'identifiant dans `demand_signals` est un invariant, **sur les deux couches**.
> **Schéma** : aucune colonne `user_id` même nullable, aucune IP, aucune empreinte de session, aucune FK
> vers `users` — en ajouter une **rouvre la question de conservation que cette conception ferme** (cf. ②).
> L'arrondi `numeric(4,2)`/`numeric(5,2)` est **porteur** : la colonne ne peut pas retenir une valeur plus
> fine, donc la grossièreté survit à un appelant qui enverrait un point exact.
> **Lecture** : aucune méthode de dépôt ne retourne de ligne individuelle, l'agrégation se fait **en SQL**,
> les horodatages sont **tronqués au jour** — une précision à la microseconde servie à côté d'un métier est
> une **clé de corrélation**. Un `findAll()` ajouté « pour déboguer » annule la session 6 sans un seul
> symptôme.
> **Corollaire d'usage, à porter dans la copie de l'écran** : **la carte compte des RECHERCHES, jamais des
> PERSONNES.** Sans identité, une personne qui cherche dix fois est indistinguable de dix personnes, et
> **aucun limiteur de débit ne corrige ça** — c'est le prix assumé de l'anonymat. Ne jamais libeller ces
> chiffres comme un nombre de gens. **Vérifier que l'écran actuel ne le fait nulle part.**

---

**④ Limitation de débit sur `POST /demand-signals` — TRANCHÉ : à faire en session 8, sous forme
RÉUTILISABLE.**

Ni l'option « PR dédiée bricolée sur une route », ni l'attente du chantier « `discover` public » — qui
n'est pas planifié et repousserait ça indéfiniment.

**Forme retenue : un mécanisme réutilisable** (garde / intercepteur nommé), **appliqué en session 8 à
`POST /demand-signals` seulement**. C'est exactement la pièce que le chantier `discover` public réclamera
au même endroit ; l'écrire une fois, correctement, coûte le même effort qu'un bricolage local et évite le
doublon.

**Ce que ça ne règle pas, et qu'il faut écrire dans la PR** : le limiteur borne le débit, il ne
dédoublonne pas par personne — voir le corollaire de ③. La menace résiduelle est le gonflement d'un
secteur **réellement vide** par un compte authentifié. Elle fausse l'**intensité**, jamais la
**direction**.

## Dettes créées par la dernière PR

**Une seule** (PR #77), écrite dans `CLAUDE.md` §11 : **aucun index des consoles admin** —
`/admin/verifications` et `/admin/demand-signals` s'atteignent **en tapant l'URL**, et rien ne mène de
l'une à l'autre. Pas de lien de nav ajouté : **aucune capacité `isAdmin` n'existe côté front** (le JWT ne
porte pas le rôle, décision 3.13-PR2 non touchée), et en fabriquer une est une **autre** responsabilité.

**Soldée par #77** : « la carte de la demande est écrite mais ILLISIBLE » (§6, réécrite).

**Relevées, inchangées** : `locality` au géocodage — **la vraie réponse au « où » lisible, deuxième fois
qu'elle est le bon correctif** · le foyer *feature toggling* · les 5 occurrences restantes de « tableau de
bord » · `body { font-family: Arial… }` dans `globals.css` écrase les polices Geist (PR dédiée) · aucune
vérification en **mode sombre** nulle part · les deux liens en ligne à 16 px de #73 · cibles tactiles
**dans les pages** non auditées (G-2, déprioritisé) · notifications prestataire ORGANIZATION illisibles ·
`docker/data/` tracké par git · verrou du refus `REJECTED` (⛔①, différé au chantier réglementé).
