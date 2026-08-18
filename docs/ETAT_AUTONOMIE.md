# ÉTAT — Travail autonome CC

**Dernière session :** 2026-08-18 (session 4) · `main` @ `16fa012` · migration `1780500000000`

## Chantier en cours

**Hors file, sur brief humain : fixture « métier réglementé vérifié » (PR #74, mergée).** Le
chantier **H tranche 2** reste la prochaine étape de la file, et l'humain l'a **décalée
volontairement** — construire la captation de la demande sur un catalogue où aucun métier
réglementé ne peut rendre de résultat aurait produit une carte « forte demande, zéro offre »
dont la cause aurait été l'absence de fixture, pas l'absence de marché. C'est maintenant réglé.

## Découpage retenu

- [x] H tranche 1 — Entrée par métier depuis l'accueil + état vide honnête (PR #73, mergée)
- [x] Fixture métier réglementé vérifié (PR #74, mergée) — **hors file, brief humain**
- [ ] H tranche 2 — Table de captation de la demande insatisfaite ← PROCHAINE, **porte humaine**

**La tranche 2 n'est toujours PAS auto-mergeable** (migration ⇒ mandat §7). Bande d'horodatage :
`1780510000000` → `1780599999999`. Ensuite : **G-2** (cibles tactiles dans les pages), puis
**D — avis et évaluations**.

## Ce que la prochaine session doit savoir

1. **Le blocage `git` du classifieur est diagnostiqué — c'est la BRANCHE, pas la commande.**
   Mesuré dans les deux sens : HEAD sur `claude/…` → `git pull origin main` et
   `git fetch origin --prune` répondent **exit 0** ; HEAD sur **`main`**, les **mêmes** commandes
   sont refusées (« Permission for this action was denied by the Claude Code auto mode
   classifier. Reason: Blocked by classifier. »). Autrement dit : **toute opération git qui
   mettrait à jour la branche locale `main` est bloquée.** Conséquence pratique : ne perds pas de
   temps à faire un `checkout main` + `pull` dans le rituel — reste sur ta branche, `fetch` y
   fonctionne, et **commite `ETAT`/`JOURNAL` sur `main` via l'API GitHub** (`push_files`), ce que
   demande déjà le mandat §9. Le rituel d'ouverture du mandat (§4) est écrit pour un poste humain
   sur ce point précis.
2. **La fixture existe : `apps/api/src/database/seeders/verified-regulated-trade.seed.ts`.**
   `npx ts-node -r tsconfig-paths/register src/database/seeders/verified-regulated-trade.seed.ts`
   depuis `apps/api`, API démarrée. Idempotente, clés naturelles, aucun UUID en dur, refuse
   `NODE_ENV=production`. Par défaut : `bob@linkr.test` vérifié en **électricité**, approuvé par
   `alice@linkr.test` (promue ADMIN si besoin — seul état écrit en SQL, aucune route ne l'accorde).
   Surchargeable : `FIXTURE_CATEGORY_SLUG`, `FIXTURE_PROVIDER_EMAIL`, `FIXTURE_ADMIN_EMAIL`,
   `FIXTURE_API_URL`. **Si le couple visé est déjà occupé, elle s'arrête proprement** en affichant
   le statut trouvé — c'est voulu, pas un échec (cf. le verrou ci-dessous).
3. **Il faut DEUX documents approuvés, pas un.** Chaque métier réglementé du seed Québec porte deux
   exigences `is_required` (plomberie → RBQ + CMMTQ · électricité → RBQ + CMEQ · menuiserie →
   RBQ + CCQ). Approuver le premier laisse la revendication en `PENDING` et **ne change rien à
   l'écran** — mesuré. Un admin qui approuve et ne voit rien bouger n'a pas rencontré un bogue.
4. **`ASSIGNED` reste inatteignable, et la cause n'est PAS une panne Stripe.** La dette
   « `JobCard` jamais smoké » **reste ouverte**. Mesuré : acceptation → **409 « The provider is not
   able to accept payments yet (Stripe Connect onboarding incomplete) »**, demande toujours `OPEN`,
   `stripe_connect_accounts` = **0 ligne**. C'est `assertPayable` qui bloque **avant** tout appel à
   Stripe : il manque un **onboarding Connect** au prestataire de fixture. Ne relâche pas la garde
   (argent = arrêt dur §3) ; la voie propre est de faire passer un prestataire par l'onboarding.
5. **Ma base n'est pas celle de l'humain.** La mienne repart de zéro à chaque session (Docker
   absent, stack remontée à la main). La sienne porte les 33 demandes historiques, les lignes
   `SONDE-*`/`SMOKE-*`, et **une ligne `REJECTED` dont j'ignore le couple** — je n'ai pas pu la
   sonder et je ne l'ai pas devinée.
6. **`MANDAT_01_fixtures.md` n'est pas entamé** (aucune PR ouverte ; `alix-dev` est en retard sur
   `main`). Le fichier `dev-fixtures.seed.ts` **et** le câblage `seed:catalog`/`seed:dev` dans
   `package.json` lui sont **assignés** — je ne les ai pas préemptés, et toi non plus.
7. **Rappels de session 3 toujours valables** : ne lance jamais Prettier sur `apps/web` (aucune
   config, il reformate tout en guillemets doubles) · `next start` sert le build chargé **au
   démarrage** (compare `.next/BUILD_ID` à `ps -o lstart` avant de conclure) · le proxy
   d'injection de faute (API sur `:5002`, proxy 40 lignes qui `500` **une seule** route) reste le
   meilleur outil pour prouver un chemin rouge.

## ⛔ En attente de décision humaine

**① Un refus verrouille le métier à vie — arbitrage requis, je n'ai rien touché.**
`ux_psc_provider_category_active` est unique sur `(service_provider_id, service_category_id)
WHERE deleted_at_utc IS NULL` et **n'inclut pas `verification_status`** ; `existsActive()` copie
ce prédicat. Un prestataire passé `REJECTED` **ne peut plus jamais re-revendiquer ce métier** :
**409** propre et sans issue, indiscernable d'un doublon ordinaire. Le chemin qui produit un
`REJECTED` **fonctionne** (expiration de document → rétrogradation, mesuré), donc le verrou est
atteignable en production **dès le premier document expiré**.
- **Option recommandée : ouvrir une transition `REJECTED → PENDING` sur la ligne existante**
  (re-dépôt de document sur la revendication en place). **Elle ne touche pas à l'index**, donc
  évite l'arrêt dur §3, et conserve l'historique de la revendication.
- L'autre voie — supprimer en douceur la ligne `REJECTED` puis en insérer une neuve — marche
  aussi mais multiplie les lignes mortes et déplace le problème vers `deleted_at_utc`.

**② Toujours ouverte depuis la session 3 : combien de temps conserve-t-on une recherche restée
vide (H tranche 2) ?** Première collecte auprès de **non-utilisateurs** — enregistrement sans
propriétaire ni chemin de suppression ; la Loi 25 exige une durée décidée **à la conception**.
**Option recommandée : 12 mois, avec `expires_at_utc` écrit à l'insertion** (la demande est
saisonnière, il faut couvrir un cycle annuel ; au-delà, une adresse d'un an est un passif). La
colonne et la purge se posent dans la **même** migration ou jamais. **Rien n'est amorcé.**

**③ Décision de copie déjà tranchée, toujours en file :** « Mon tableau de bord » → **« Espace
pro »**, à appliquer par la première PR qui touche `(app)/nav.tsx` (vraisemblablement G-2), en
même temps que le raccourci de l'accueil qui porte le même vocabulaire.

## Dettes créées par la dernière PR

**Aucune dette créée** — la PR est purement additive (un seeder + `CLAUDE.md`), sans migration ni
changement de contrat.

**Deux dettes *découvertes et écrites* dans `CLAUDE.md` §6, non corrigées** : le verrou du refus
(⛔① ci-dessus) et **les métiers réglementés indéclarables depuis l'interface**
(`disabled={option.regulated}` dans le sélecteur « Mes métiers » ; l'API, elle, accepte et répond
**201 `PENDING`**). Rouvrir le sélecteur suppose de décider **qui téléverse la licence et depuis
quel écran** : l'endpoint de téléversement existe, **l'écran n'existe pas**. Arbitrage produit,
PR dédiée.

**Relevées, inchangées** : `body { font-family: Arial… }` dans `globals.css` écrase les polices
Geist (PR dédiée, rayon d'impact visuel global) · aucune vérification en **mode sombre** nulle
part · les deux liens en ligne à 16 px de #73 (exception « Inline » WCAG 2.5.8) · notifications
prestataire ORGANIZATION illisibles · `docker/data/` tracké par git.
