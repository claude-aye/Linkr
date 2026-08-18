# ÉTAT — Travail autonome CC

**Dernière session :** 2026-08-18 (session 5) · `main` @ `38cf2de` · migration `1780500000000`

## Chantier en cours

**Hors file, sur brief humain : refermer l'entrée client sur les métiers réglementés (PR #75, mergée).**
Le MVP se lance en **métiers informels seulement**. **H tranche 2** reste la prochaine étape de la
file — toujours **à porte humaine** (migration ⇒ mandat §7), et toujours en attente de la décision
de conservation (⛔② ci-dessous).

## Découpage retenu

- [x] H tranche 1 — Entrée par métier depuis l'accueil + état vide honnête (PR #73, mergée)
- [x] Fixture métier réglementé vérifié (PR #74, mergée) — **hors file, brief humain**
- [x] Fermeture de l'entrée client réglementée + « Espace pro » (PR #75, mergée) — **hors file, brief humain**
- [ ] H tranche 2 — Table de captation de la demande insatisfaite ← PROCHAINE, **porte humaine**

Bande d'horodatage de migration : `1780510000000` → `1780599999999`. Ensuite : **G-2** (cibles
tactiles **dans les pages** — « Voir le détail → » mesuré à 16 px sur le tableau de bord, non
corrigé), puis **D — avis et évaluations**.

## Ce que la prochaine session doit savoir

1. **⚠️ LA RÈGLE QUE LA PR #75 A POSÉE, ET QU'IL NE FAUT PAS « CORRIGER » : offert ≠ résolvable.**
   `recherche/page.tsx` tire **un seul** `GET /service-categories` et en dérive **deux** ensembles.
   Le filtre `tradesOfferedAtLaunch` s'applique à `categoryOptions` (ce que la liste déroulante
   **offre**) et **JAMAIS** à `categories` (contre quoi `?categoryId=` est **résolu**). Le narrowir
   aussi — une ligne de moins, ça ressemble à une simplification — fait retomber tout lien
   réglementé partagé sur la branche « métier inconnu » de `NoResults` : **le nom du métier ET
   l'explication réglementée disparaissent, sans erreur ni symptôme.** Contrefactuel construit et
   mesuré dans la PR. Le commentaire est au point de dérivation ; **pas** dans §13.1, parce que
   modifier §13.1 est un arrêt dur (⛔③ ci-dessous).
2. **Rouvrir le segment réglementé = UNE ligne**, dans `apps/web/src/lib/catalog/launch-scope.ts`
   (`isTradeOfferedAtLaunch` → `regulationLevel === 'INFORMAL'`). Le filtre est **dérivé de la
   donnée**, jamais une liste d'UUID : une nouvelle catégorie informelle apparaît toute seule. Le
   sélecteur **prestataire** (« Mes métiers ») n'a **pas** été touché — il bloquait déjà.
3. **Montage de la stack dans le bac à sable — le détail qui coûte du temps.** Docker absent ;
   Postgres 16 présent mais **PostGIS ABSENT**. `apt-get install postgresql-16-postgis-3` **échoue
   en 404** tant qu'on n'a pas fait `apt-get update` d'abord (dépôt périmé sur `libmysqlclient21`).
   Ensuite : créer le rôle `linkr` **SUPERUSER**, la base, `CREATE EXTENSION postgis`, puis
   `migration:run` et le seed Québec.
4. **`pkill -f "next start"` NE TUE PAS le serveur** — le processus s'appelle `next-server`. Pire :
   un serveur survivant sert le build chargé **à son démarrage**, dont le CSS a été **remplacé sur
   disque** par le rebuild → page **sans styles**, et une mesure d'interface silencieusement fausse
   (en-tête 57 px, tuiles 17 px). **Ça m'a mordu.** Contrôle : comparer le `BUILD_ID` servi à celui
   du disque **et** faire un `curl` sur le chunk CSS référencé (doit répondre 200, pas 404).
5. **Ma base n'est pas celle de l'humain.** La mienne repart de zéro à chaque session. Les comptes
   de catalogue que je publie (7 actives : 3 REGULATED / 4 INFORMAL) valent **pour ma base**.
6. **`MANDAT_01_fixtures.md` n'est toujours pas entamé.** `dev-fixtures.seed.ts` **et** le câblage
   `seed:catalog`/`seed:dev` sont **assignés au collaborateur** — ne pas les préempter.
7. **Rappels toujours valables** : le blocage `git` est **la branche, pas la commande** (toute
   opération qui mettrait à jour `main` local est refusée → rester sur sa branche, committer
   `ETAT`/`JOURNAL` sur `main` **via l'API GitHub**) · ne jamais lancer Prettier sur `apps/web` ·
   le proxy d'injection de faute (API sur `:5002`, 40 lignes, `500` sur **une seule** route) reste
   le meilleur outil pour prouver un chemin rouge · **`ASSIGNED` reste inatteignable** faute
   d'onboarding Stripe Connect (`assertPayable` **409**, avant tout appel à Stripe) → dette
   « `JobCard` jamais smoké » **toujours ouverte**.

## ⛔ En attente de décision humaine

**① Un refus verrouille le métier à vie — inchangé depuis la session 4, rien touché.**
`ux_psc_provider_category_active` est unique sur `(service_provider_id, service_category_id)
WHERE deleted_at_utc IS NULL` et **n'inclut pas `verification_status`** ; `existsActive()` copie ce
prédicat. Un prestataire passé `REJECTED` **ne peut plus jamais re-revendiquer ce métier** : **409**
propre et sans issue. Le chemin qui produit un `REJECTED` fonctionne (expiration de document →
rétrogradation, mesuré), donc le verrou est atteignable **dès le premier document expiré**.
- **Option recommandée : ouvrir une transition `REJECTED → PENDING`** sur la ligne existante. Elle
  **ne touche pas à l'index**, donc évite l'arrêt dur §3, et conserve l'historique.

**② Combien de temps conserve-t-on une recherche restée vide (H tranche 2) ? — inchangée.**
Première collecte auprès de **non-utilisateurs** : enregistrement sans propriétaire ni chemin de
suppression ; la Loi 25 exige une durée décidée **à la conception**. **Option recommandée : 12 mois,
`expires_at_utc` écrit à l'insertion.** La colonne et la purge se posent dans la **même** migration
ou jamais. **Rien n'est amorcé.**

**③ NOUVELLE — faut-il inscrire « offert ≠ résolvable » dans `CLAUDE.md` §13.1 ?**
C'est exactement le profil d'un piège de §13.1 : le code *ressemble* à un filtre oublié, et le
« corriger » détruit l'état vide honnête **sans aucun symptôme**. Mais **modifier §13.1 est sur la
liste d'arrêt (mandat §3.9)**, donc je ne l'ai pas fait. **Option recommandée : oui, l'y ajouter**
(une entrée courte renvoyant à `lib/catalog/launch-scope.ts` et au commentaire de
`recherche/page.tsx`). En attendant, la protection ne vit que dans les commentaires de code et
l'entrée §11.

*(L'item ③ de la session 4 — « Mon tableau de bord » → « Espace pro » — est **soldé** : appliqué
par la PR #75, avec le raccourci de l'accueil qui portait le même vocabulaire.)*

## Dettes créées par la dernière PR

**Une seule, écrite dans `CLAUDE.md` §6** : le **périmètre de lancement est codé en dur côté front**
(`lib/catalog/launch-scope.ts`) alors que le projet prévoit un *feature toggling* par tuple
pays/subdivision (`regulatory_requirements`), **son foyer naturel à terme**. Construire ce mécanisme
pour un seul booléen aurait été de la spéculation ; le correctif est de déplacer la règle derrière la
couche de bascule **le jour où elle doit varier par région**.

**Relevées, inchangées** : les 5 autres occurrences de « tableau de bord » (titre du tableau de bord,
lien de retour, confirmation de `/providers/new`) — vocabulaire mixte assumé, non empaqueté ·
`body { font-family: Arial… }` dans `globals.css` écrase les polices Geist (PR dédiée) · aucune
vérification en **mode sombre** nulle part · les deux liens en ligne à 16 px de #73 · cibles tactiles
**dans les pages** non auditées (G-2) · notifications prestataire ORGANIZATION illisibles ·
`docker/data/` tracké par git.
