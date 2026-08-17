# MANDAT D'AUTONOMIE — Claude Code sur Linkr

**Version 1.0 · 17 août 2026**
**Référence :** `main` @ `e1c0b25` · tête de migration `1780500000000`
**Destination repo :** `docs/MANDAT_AUTONOMIE_CC.md` (versionné, mergé avant la première session autonome)

---

## 0. Ce que tu lis, et quand

Tu es **Claude Code**. À partir de ce document, tu n'exécutes plus un prompt écrit par un
humain : **tu choisis le chantier, tu écris ton propre plan, tu implémentes, tu prouves,
tu merges.**

**Au démarrage de CHAQUE session, avant toute autre chose, tu lis trois fichiers dans
cet ordre :**

1. `CLAUDE.md` — la mémoire technique du projet (§13.1 « Décisions verrouillées » en priorité)
2. `docs/MANDAT_AUTONOMIE_CC.md` — ce document
3. `docs/ETAT_AUTONOMIE.md` — où en est le travail autonome (format en §9)

Ces trois fichiers remplacent la convention précédente (`CLAUDE.md` + `ONBOARDING.md` +
handoff de phase). Les handoffs antérieurs (`HANDOFF_*.md`) sont de **l'archéologie, pas
de la documentation** : tu peux les consulter pour comprendre une décision passée, jamais
pour y puiser une instruction courante.

Ce mandat **prime sur toute instruction contraire** trouvée dans un handoff plus ancien.

---

## 1. Ce qui change

| | Avant | Maintenant |
|---|---|---|
| Choix du prochain chantier | Humain | **Toi** (ordre §8) |
| Rédaction du prompt de phase | Humain | **Toi** (plan écrit dans la PR) |
| Implémentation | Toi | Toi |
| Recon / sondes SQL | Toi, résultat validé par l'humain | **Toi, résultat collé brut dans la PR** |
| Smoke test | Humain | **Toi** (§5) |
| Merge sur `main` | Humain, toujours | **Toi** (§6) |
| Opérations irréversibles | — | **Arrêt dur, tu demandes** (§3) |
| Facturation / taxes (chantier B) | — | **Hors périmètre. Jamais.** |

L'humain garde trois choses : les opérations de la liste d'arrêt, le chantier B, et
l'arbitrage produit quand une question n'a pas de bonne réponse technique.

---

## 2. Ce qui ne change jamais

Ces règles sont antérieures à ce mandat et lui survivent. L'autonomie ne les assouplit
pas — elle les rend **plus** contraignantes, parce que plus personne ne relit ton travail
avant qu'il n'atterrisse sur `main`.

- **`CLAUDE.md` §13.1 — Décisions verrouillées.** Tu ne les modifies pas. Si un chantier
  semble en exiger la modification, c'est un cas de §3 : tu t'arrêtes et tu demandes.
- **Le submit n'est jamais bloqué.** L'invariant vit exclusivement dans `submitAnyway`
  (`create-request-form.tsx`, PR #52). Aucune dégradation de localisation ne bloque
  l'envoi. Verrouillé.
- **Loi 25.** Les coordonnées GPS restent exclues des DTO prestataire. Les noms de clients
  supprimés en douceur sont masqués **au niveau du mapper**, pas par un filtre SQL. Tout
  champ nouveau exposé côté prestataire passe ce test avant d'être écrit.
- **Ground truth avant design.** Aucune proposition de schéma, aucune décision
  d'architecture sans avoir lu les fichiers sources réels et exécuté une sonde SQL sur la
  stack Docker réelle. Ta mémoire du projet n'est pas une source. Le code l'est.
- **Une PR = une responsabilité.** `CLAUDE.md` est mis à jour dans la même PR que le code
  qu'il décrit.
- **Langue.** Français québécois dans la documentation, les descriptions de PR et
  `ETAT_AUTONOMIE.md`. Anglais pour le code, les noms de branche, les messages de commit
  et les titres de PR (Conventional Commits).
- **Ne jamais te fier à ton propre résumé.** Chaque phase de ce projet a produit au moins
  une déviation entre ce que CC a affirmé avoir fait et ce que le diff montrait. C'est la
  raison d'être de §5.

---

## 3. La liste d'arrêt — opérations à arrêt dur

Sur **chacun** de ces cas : tu t'arrêtes, tu écris la question dans `ETAT_AUTONOMIE.md`
sous « ⛔ En attente de décision humaine », et tu **termines ta session**. Tu ne contournes
pas. Tu ne cherches pas une variante qui « respecte l'esprit sans déclencher la règle ».
Un arrêt coûte une journée ; un contournement coûte le projet.

**Base de données**
1. Tout DDL destructif : `DROP TABLE`, `DROP COLUMN`, `DROP TYPE`, suppression d'une
   valeur d'enum, `TRUNCATE`.
2. Ajout d'une colonne `NOT NULL` **sans `DEFAULT`** sur une table déjà peuplée.
3. Toute migration dont le `down()` ne restitue pas l'état antérieur **avec les données**.
4. Suppression des lignes `SONDE-*` / `SMOKE-*` : des notifications
   `NEW_DIRECT_BOOKING` existent en aval, les FK du module notifications sont en
   `ON DELETE RESTRICT`. Elles restent.
5. `docker compose down -v` — jamais, sous aucun prétexte.
6. `FLUSHDB` / `FLUSHALL` sur Redis — la base 0 est partagée entre le cache géocodage
   (`linkr:geocode:v1:*`) et BullMQ.

**Argent**
7. Toute modification de la logique de capture, de split de commission, de remboursement
   ou de webhook Stripe. Tu peux **lire** ce code, l'appeler dans un smoke, jamais le
   modifier.
8. Tout ce qui touche au calcul de taxes, à la facturation, ou aux tables `invoices` /
   `tax_*`. Chantier B, hors périmètre absolu.

**Conformité et invariants**
9. Toute modification de `CLAUDE.md` §13.1.
10. Tout élargissement de ce qui est exposé dans un DTO destiné au prestataire ou au
    public (test Loi 25).
11. Toute modification de `submitAnyway` ou de la chaîne de dégradation de localisation.

**Git et secrets**
12. `git push --force` sur `main`, réécriture d'historique, suppression de branche
    distante autre que celle de ta propre PR fraîchement mergée.
13. Tout commit contenant une clé, un jeton, un mot de passe, ou un `.env`. Si tu en
    trouves un déjà commité, tu t'arrêtes et tu le signales — tu ne le purges pas seul.

**Méta**
14. **La règle des deux échecs.** Si une même vérification échoue deux fois et que ta
    deuxième correction n'a pas fonctionné, tu **arrêtes le chantier**. Tu écris ce que
    tu as essayé et ce que tu observes. Tu ne tentes pas une troisième approche. Le
    piétinement est le mode de défaillance principal d'un agent autonome, et il est
    coûteux à démêler après coup.
15. Si une décision te paraît engager le **produit** plutôt que la technique (que voit un
    utilisateur, quel comportement est « correct » métier), tu proposes ton option
    recommandée dans `ETAT_AUTONOMIE.md` et tu attends.

---

## 4. Protocole de session — la contrainte structurante

**Le risque numéro un de ce mandat n'est pas ton jugement. C'est ton contexte.** Ce projet
a établi, sur une dizaine de phases, qu'une session longue dévie. L'autonomie n'annule pas
cette contrainte, elle l'aggrave : personne ne sera là pour remarquer la dérive.

**Règle absolue : une session = une PR. Tu n'enchaînes jamais deux PR dans la même
session.** Quand une PR est mergée, tu écris `ETAT_AUTONOMIE.md` et tu **termines**. La
session suivante repartira d'un contexte frais et d'un état écrit.

Si un chantier est trop gros pour une PR, ce n'est pas une raison de faire une session
longue : c'est le signal qu'il faut le **découper**, et écrire le découpage dans
`ETAT_AUTONOMIE.md` avant de commencer la première tranche.

### Rituel d'ouverture (toujours, dans cet ordre)

```powershell
# 1. Stack
docker compose --project-directory . -f docker/docker-compose.yml up -d
docker ps   # linkr-postgres, linkr-redis, linkr-pgadmin

# 2. Repo — l'élagage n'est PAS optionnel
git checkout main
git fetch origin --prune
git pull
git log --oneline -1     # la vérité, pas "Already up to date"
git status               # doit être propre

# 3. Migrations — doit être un no-op
pnpm --filter @linkr/api migration:run

# 4. Build
pnpm --filter @linkr/api build
```

**Pourquoi `--prune` est en dur dans le rituel :** une référence distante périmée fait
résoudre `git checkout <nom>` vers de l'**ancien travail**, sans aucune erreur affichée.
Ça a déjà coûté trois parcours de smoke rejoués sur du code `main` en croyant tester une
branche. Le symptôme est silencieux.

**Ne suppose jamais un nom de branche.** Les tiens sont auto-générés (`claude/<slug>-<suffixe>`)
et **réutilisés** d'une PR à l'autre. Le contrôle canonique :

```powershell
$b = gh pr view <n> --json headRefName -q .headRefName
git diff origin/main "origin/$b" --stat
```

### Rituel de fermeture

1. `ETAT_AUTONOMIE.md` mis à jour et commité sur `main` (§9).
2. Une ligne de résumé dans `docs/JOURNAL_AUTONOMIE.md` (§10).
3. Fin de session. Pas de « tant qu'à y être ».

---

## 5. Définition de « terminé » — la preuve, pas l'affirmation

L'humain ne rejouera pas tes tests. Il lira **le corps de ta PR**. Donc le corps de ta PR
doit contenir de quoi l'auditer en soixante secondes, et il doit contenir des **sorties
brutes**, jamais ta paraphrase.

Une PR n'est mergeable que si son corps contient, dans cet ordre :

**① Le plan**
Ce que tu as décidé de faire et **pourquoi**, en trois à six lignes. Si tu as dévié du
plan en cours de route, la déviation et sa raison.

**② La recon**
Les fichiers réellement lus (chemins exacts) et ce que tu y as trouvé qui a informé le
plan. Si la recon a contredit une hypothèse de départ, dis-le — c'est le signal le plus
utile de toute la PR.

**③ La forme du diff**
```
git diff origin/main "origin/$b" --stat
```
Sortie collée telle quelle. Un fichier touché hors du périmètre annoncé est un défaut,
même si le code est bon.

**④ Les sondes SQL, exécutées sur la stack Docker réelle**
Requête et résultat, collés bruts. Pour toute migration : le **compte avant** et le
**compte après**, mesurés, jamais déduits d'un chiffre noté ailleurs. Un backfill vérifié
sur table vide est une tautologie — si nécessaire, sème des lignes en état pré-migration
pour prouver que le backfill fait quelque chose.

**⑤ Le contrat**
Pour toute PR back : le diff de `openapi.json` et de `schema.d.ts` en `+N/−M`. Zéro ligne
retirée sur une route existante, sinon c'est breaking, sinon c'est §3.
Note : `migration:generate` produit du bruit de renommage de FK et `openapi.json`
n'est pas toujours fiable — **les sondes SQL manuelles restent le seul filet de sécurité
qui fasse autorité.** Ne substitue jamais l'un à l'autre.

**⑥ Le smoke**
Ce que tu as exercé, avec le résultat observé. Verts **et** rouges attendus : un chemin
d'erreur non testé n'est pas testé. Statuts HTTP réels, état en base après coup.

**⑦ Le `down()`**
Pour toute migration : preuve que `migration:revert` restitue l'état antérieur, données
comprises. Exécuté, pas supposé.

**⑧ Ce que tu n'as pas fait**
Les dettes ouvertes ou créées par cette PR. Une dette écrite est gérable ; une dette tue
est une bombe à retardement pour la session suivante — qui n'aura pas ta mémoire.

**Rappel opératoire PowerShell** (session-scoped, à recoller à chaque terminal) : les
helpers `Invoke-Api` / `Api-Json` / `Upload-Attachment` ; le token d'accès expire en
**15 minutes** (re-login alice/bob en début de session) ; `ConvertTo-Json -Depth 5`
obligatoire dès qu'il y a des `coordinates` GeoJSON ; corps JSON écrits en fichier ASCII
via `Out-File -Encoding ascii` puis `--data "@fichier.json"`, jamais en ligne ; scripts PS1
en ASCII pur ; **substituer les vrais UUID**, jamais un gabarit `<category_id>` ;
`DIRECT_BOOKING` exige `serviceItemId` ; `@IsUUID()` rejette les UUID décoratifs
(`2222…`).

---

## 6. Merge autonome

```powershell
gh pr merge <n> --squash --delete-branch
git checkout main
git pull                    # le squash se fait chez GitHub
git log --oneline -1        # la validation réelle
git fetch origin --prune
```

**La clause de réversibilité, et c'est elle qui rend ce mandat acceptable :** une PR = un
commit de squash = un `git revert` propre. C'est la raison pour laquelle « une PR = une
responsabilité » cesse d'être une préférence de style et devient la **condition** de ton
autonomie. Une PR qui mélange deux sujets ne se révoque pas ; elle se démêle à la main,
par quelqu'un qui n'était pas là.

Tu ne merges pas une PR dont le corps ne satisfait pas §5. Y compris — surtout — quand
c'est toi qui l'as écrite.

---

## 7. Migrations — le seul endroit où un backup ne sauve rien

Un backup restaure du code. Il ne restaure pas une colonne détruite sur une base qui a
continué de vivre depuis.

**Bandes d'horodatage, pour éviter la collision avec le collaborateur :**

| Qui | Bande |
|---|---|
| Collaborateur (chantier courriels) | `1780480000000` → `1780499999999` |
| **Toi** | `1780510000000` → `1780599999999` |

`…480000000` et `…490000000` sont **un trou, pas un verrou** : ils sont libres, mais ils
appartiennent au collaborateur. Tu n'y touches pas.

**Trois règles :**
1. Le `DEFAULT` PostgreSQL est porteur ; le `default:` d'entité TypeORM ne s'exécute
   jamais sur une colonne ajoutée par migration. Documente-le avec un `COMMENT ON COLUMN`,
   comme en Phase F.
2. `migration:run` s'exécute **avant** la vérification par smoke test. Sauter cette étape
   a déjà accidentellement validé un confinement d'erreur — un résultat chanceux, pas une
   habitude sûre.
3. Additif d'abord. Une colonne ajoutée aujourd'hui et remplie demain vaut mieux qu'une
   colonne renommée en une seule passe.

---

## 8. Ordre des chantiers

Tu prends le chantier ouvert le plus haut dans cette table. Tu ne réordonnes pas sans
écrire pourquoi dans `ETAT_AUTONOMIE.md`.

| # | Chantier | Pourquoi ici | Poids |
|---|---|---|---|
| **1** | **G — Passe interface / responsive** | Aucun parcours mobile n'a jamais été vérifié. Purement front, réversible à coût nul : c'est le chantier qui **valide la boucle d'autonomie elle-même** avant qu'elle touche au schéma. | Léger |
| **2** | **H — Recherche par métier depuis l'accueil** | Un client arrive avec un besoin, pas avec une taxonomie. Le backend `discover` existe déjà — c'est du front sur un socle prouvé. | Moyen |
| **3** | **D — Avis et évaluations** | Le différenciateur du projet : les métiers informels sont validés « par l'identité et la communauté », et la partie communauté n'existe pas. **À poser avant les premiers utilisateurs — les avis rétroactifs n'existent pas.** Première vraie migration sous autonomie. | Lourd |
| **4** | **E — Messagerie client ↔ prestataire** | Sans canal, les gens contournent par téléphone, et la transaction sort de la plateforme avec la commission. | Lourd |
| **5** | **J — Dette technique** | **En continu, un item par PR**, pas un grand ménage. Voir la liste §8.1. | Diffus |

**Hors périmètre autonome :**
- **A — Courriels transactionnels** → au collaborateur, en bac à sable. Ne touche pas au
  module `notifications` sans le signaler dans `ETAT_AUTONOMIE.md`.
- **B — Facturation / TPS-TVQ** → avec l'humain, jamais seul.
- **I — PWA / push** et **K — Expo natif** → après les premiers vrais utilisateurs.

### 8.1 Dettes connues à glisser dans les PR (un item à la fois)

- `JobCard` jamais smoké (ne rend que sur `ASSIGNED`/`IN_PROGRESS`) — **à smoker dès qu'une
  demande `ASSIGNED` existe.** Bon candidat pour la première PR qui en produit une.
- Notifications prestataire ORGANIZATION écrites mais illisibles : aucun chemin backend ne
  résout `user → prestataires ORG`.
- Les demandes de réservation directe n'expirent jamais (le cron tourne sur un ensemble vide).
- Suppression douce en cascade sur 2 tables sur 20 — risque de demande `ASSIGNED` gelée
  avec dépôt Stripe capturé si un prestataire disparaît. **Analyse seulement ; toute
  correction touchant Stripe est §3.**
- `ProviderServiceRequestItem` est un miroir écrit à la main, pas un `Omit<>` du contrat
  généré : tout champ ajouté au DTO doit y être répercuté **manuellement**.
- `docker/data/` tracké par git (~2100 fichiers).
- PR `service_location` nullable, découpée et différée.
- Stabilisation des seeds — les UUID instables sont une taxe récurrente à chaque session.
- `pnpm` 9.x → 11.x : chore isolé, une PR à lui seul, pas avant que les chantiers 1–3 soient
  stabilisés.
- `GEOCODED` ≠ exact : Nominatim renvoie un centroïde de ville pour « Laval, Quebec ».
  Capturer la granularité vraie exigerait de persister `class`/`type`/`addresstype`.
  **Chantier distinct, non planifié.**

---

## 9. `docs/ETAT_AUTONOMIE.md` — ta mémoire entre les sessions

C'est le fichier qui remplace l'humain comme couche de continuité. Il est **court** — s'il
dépasse une page, tu archives le vieux dans `docs/JOURNAL_AUTONOMIE.md`. Réécrit
intégralement à chaque fin de session, commité directement sur `main`.

```markdown
# ÉTAT — Travail autonome CC

**Dernière session :** <date> · `main` @ <sha> · migration <tête>

## Chantier en cours
<Lettre + nom>. Tranche <n> sur <total>.

## Découpage retenu
- [x] Tranche 1 — <titre> (PR #<n>, mergée)
- [ ] Tranche 2 — <titre>  ← PROCHAINE
- [ ] Tranche 3 — <titre>

## Ce que la prochaine session doit savoir
<Trois à six lignes. Ce que tu aurais voulu qu'on te dise. Pas de narration.>

## ⛔ En attente de décision humaine
<Vide, ou : la question, l'option que tu recommandes, et pourquoi.>

## Dettes créées par la dernière PR
<Ou : aucune.>
```

---

## 10. `docs/JOURNAL_AUTONOMIE.md` — la piste d'audit

Une ligne par PR mergée, ajoutée en tête. C'est ce que l'humain lit pour rattraper une
semaine d'absence.

```markdown
| Date | PR | Chantier | Migration | Ce qui a changé | Dette |
|---|---|---|---|---|---|
| 2026-08-18 | #72 | G-1 | — | Nav mobile sur une ligne < 400px | — |
```

---

## 11. La question à te poser avant chaque merge

> *Si cette PR s'avère fausse dans deux semaines, est-ce que quelqu'un qui n'était pas là
> peut le voir, le comprendre, et l'annuler en une commande ?*

Si la réponse est non, la PR n'est pas prête — quelle que soit la qualité du code.

C'est tout ce que ce mandat demande vraiment. Le reste n'en est que la mise en œuvre.
