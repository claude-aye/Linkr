# REVUE — Ce qui manque avant un premier utilisateur réel

**État :** `main` @ `b22d3dd` · migration `1780520000000` · 13 PR mergées en 12 sessions autonomes

> **Version fusionnée.** Cette revue a été relue contre le source, point par point. Deux
> affirmations ont été corrigées et quatre manques ajoutés à leur place. Les mentions
> **[vérifié]** signalent une lecture du code, avec sa référence. Deux revues qui se
> contredisent valent moins qu'une seule qui a raison : celle-ci remplace la précédente.

---

## 1. Ce qui fonctionne, prouvé sur ta base

Un client cherche un métier informel → trouve un prestataire avec sa note → réserve →
le prestataire accepte → démarre → complète → le client évalue → le prestataire répond une
fois → le client peut retirer son avis. Chaque recherche infructueuse nourrit une carte de
recrutement anonyme, lisible par un administrateur.

**Tout ça a été mesuré sur ta base, pas seulement dans un bac à sable.** C'est un produit qui
tient debout.

---

## 2. Ce qui bloque vraiment — par ordre

### ① L'onboarding Stripe Connect côté prestataire — LE blocage

**Aucun prestataire réel ne peut recevoir d'argent.** Il n'existe aucun écran d'inscription
Connect ; la seule ligne `stripe_connect_accounts` de ta base a été fabriquée par un seeder
avec des identifiants factices.

Concrètement : tu recrutes un artisan, il s'inscrit, un client le réserve, **le dépôt
échoue**, et personne n'est payé. La proposition transactionnelle entière — le côté « Uber »
de ton positionnement — ne fonctionne pas.

C'est aussi la **première friction qu'un vrai prestataire rencontrera**, et celle qui décide
s'il reste. Tout le reste de cette liste est vivable ; celui-ci ne l'est pas.

**[vérifié] Le trou est côté front SEUL, et ça change le chiffrage.** Le backend est complet :
trois routes montées (`stripe-connect/*.controller.ts:26,45,61` — `onboard`, `status`,
`refresh-link`). Côté `apps/web`, **zéro appel** : les six occurrences de « stripe » sont
toutes des *commentaires* dans `dashboard/_actions/`. Ce n'est pas un module à écrire, c'est
une page plus un relais BFF.

### ② Les courriels — la sonnette qui ne sonne pas — et la réinitialisation de mot de passe

Un prestataire qui n'est pas connecté **n'apprend jamais** qu'il a une demande. Les
notifications en base existent depuis des mois ; personne ne vit dans l'application.

Sans courriel, une place de marché n'a aucun moyen d'alerter l'un ou l'autre côté. Tu viens
de reprendre ce mandat — c'est le bon appel, et ça débloque aussi la tranche 2b
(« prévenez-moi ») et les scripts de fixture.

**[vérifié] Il n'existe AUCUNE réinitialisation de mot de passe, et elle appartient à ce
lot-ci.** `auth.controller.ts` expose signup / login / refresh / me / Google / Apple —
**zéro** occurrence de `forgot` ou `reset` dans `apps/api` comme dans `apps/web`. Un artisan
recruté qui oublie son mot de passe est verrouillé **définitivement** : aucune console admin
ne peut le débloquer (elle ne fait que documents de vérification et carte de la demande).

C'est précisément la stratégie (a) qui le déclenche — faire passer de vraies personnes par la
vraie inscription. Et comme le seul mécanisme de reprise possible est un jeton envoyé par
courriel, **ça se chiffre avec ②, jamais après.** Livrer le canal courriel sans poser la
réinitialisation dans le même lot, c'est le repayer une seconde fois.

### ③ L'arbitrage du dépôt `FAILED`

Mesuré en session 9 : `captureDeposit` part **après** `commitTransaction()`. Une panne Stripe
laisse donc une demande `ASSIGNED` avec un dépôt `FAILED` que rien ne reprend — le
prestataire voit « service indisponible » alors que le travail lui est attribué.

**[vérifié]** `service-requests.service.ts:386` (`commitTransaction`) puis `:396`
(`captureDeposit`), hors du `try/catch`. Un throw remonte en 502 avec la demande déjà
`ASSIGNED`.

Ce n'est pas un bogue, c'est une **transaction distribuée sans compensation**. Deux sorties :
mettre la capture en file BullMQ avec reprise, ou annuler l'affectation quand la capture
échoue. Les deux touchent la logique d'argent, donc **avec toi dans la boucle**.

Il est ici plutôt que plus bas parce qu'il devient réel **le jour où ① existe** : tant que
personne n'encaisse, il ne se manifeste pas.

### ④ Aucun canal entre client et prestataire

Ils ne peuvent pas se coordonner. Pas de « j'arrive à 14 h », pas de « quelle porte ? ». Un
service à domicile sans coordination ne se rend pas.

**[vérifié] Rien n'est exposé, nulle part — et l'option minimale coûte plus cher que prévu.**
Aucun champ `phone` ou `email` dans un seul DTO de module ; le prestataire ne reçoit que
`clientDisplayName` (`provider-service-request-item.dto.ts:76`) ; `users.controller.ts`
n'expose que `PATCH /me` et `DELETE /me`, donc aucune voie pour lire autrui.

Surtout : **aucun utilisateur ne peut avoir de téléphone aujourd'hui.** L'inscription l'exclut
explicitement du payload, il n'existe aucun écran de profil, et **aucun écran web ne consomme
`/users`**. « Exposer le téléphone après affectation » suppose d'abord de le *collecter* —
champ, écran, décision d'exposition — et l'OTP n'existe pas non plus (dette
`verification_level`, §6 de `CLAUDE.md`).

Deux options, moins éloignées en coût que la revue initiale ne le supposait :
- **Minimal** — collecter puis exposer le téléphone des deux parties une fois la demande
  `ASSIGNED`. Coût : la transaction sort de la plateforme, et la deuxième réservation se fait
  sans toi.
- **Messagerie interne** — le modèle DoorDash. Le seul canal, donc la commission reste. Coût :
  chantier lourd, et un devoir de modération que tu n'as pas les moyens d'outiller.

L'argument commercial penche vers la messagerie ; l'argument de calendrier vers le minimal —
et l'écart de coût réel entre les deux est plus mince qu'il n'y paraît. **À trancher, pas à
laisser flotter.**

### ⑤ La limitation de débit sur `login`, avant le premier vrai compte

**[vérifié]** `POST /auth/login` et `POST /auth/signup` sont `@Public()` **sans aucune
limitation de débit**. Le mécanisme existe pourtant et a été écrit réutilisable en session 8
(`common/rate-limit/`) — il n'est branché que sur `demand-signals.controller.ts:72` et
`reviews.controller.ts:62,116`.

Coût : un décorateur et un provider, exactement la forme pour laquelle la session 8 l'a
construit. Ce n'est pas un chantier, c'est une demi-journée — mais elle doit tomber **avant**
qu'un formulaire de connexion soit exposé avec de vrais comptes derrière. Le bourrage
d'identifiants non compté est un risque plus concret que la moitié du §4.

---

## 3. L'angle mort : ce qui n'est pas du code

**Douze sessions de produit, zéro session de conformité.** Rien de ce qui suit n'est
technique, et rien ne peut être délégué à CC.

- **Politique de confidentialité et conditions d'utilisation.** N'existent nulle part dans le
  dépôt **[vérifié]**. La Loi 25 impose de publier une politique de confidentialité et de
  désigner une personne responsable de la protection des renseignements personnels, avec ses
  coordonnées.
- **Consentement à la collecte** au moment de l'inscription, avec les finalités énoncées.
  **[vérifié]** Le formulaire d'inscription n'a **ni case de consentement ni lien** vers quoi
  que ce soit.
- **Statut d'intermédiaire de paiement.** Tu prélèves une commission sur des transactions
  entre tiers. Ça a des implications — inscription TPS/TVQ, obligations déclaratives, peut-être
  davantage.
- **Le chantier B (facturation / taxes) est entièrement à faire.** Il est resté hors du
  périmètre autonome depuis le premier jour, à raison.

**Je ne suis pas juriste et rien de ce paragraphe n'est un avis juridique.** Mais c'est le
seul bloc de cette revue qui peut arrêter un lancement sans qu'aucune ligne de code n'en soit
la cause, et il vaut une consultation avant ton premier vrai utilisateur.

---

## 4. Ce qui peut attendre, sans hésiter

- Segment réglementé (back complet et prouvé, il manque deux écrans prestataire).
- Verrou du refus `REJECTED` — inatteignable tant que le réglementé est fermé.
- Sélecteur de tri client — différé avec sa condition chiffrée.
- Notifications prestataire ORGANIZATION illisibles.
- Colonne `locality` — les notifications ne peuvent pas dire où.
- **Dette auth (`CLAUDE.md` §6) : rotation du refresh à usage unique, aucune révocation.** Deux
  faces. La course d'abord : des `fetch` BFF parallèles peuvent présenter un refresh déjà
  consommé → 401 → déconnexion parasite. L'absence de liste de révocation ensuite : un refresh
  compromis reste valide jusqu'à son `exp`, soit **7 jours**, et les anciens ne sont jamais
  invalidés. Vivable à ton échelle actuelle, à durcir lors d'une phase sécurité auth dédiée —
  mais ça ne doit pas rester hors liste.
- Index des consoles admin, capacité `isAdmin` côté front.
- « Deux causes, un 409 » — vraie dette d'architecture, aucun blocage.
- `globals.css` écrasant les polices Geist **[vérifié, `globals.css:25`]** · pnpm 9 → 11
  **[vérifié, `package.json:5` — `pnpm@9.15.4`]**.

### Corrigé depuis la première version

- ~~`docker/data/` tracké~~ — **faux [vérifié]**. Le dossier est dans `.gitignore:51`,
  `git ls-files docker/data` renvoie **0 fichier**, et `git log --diff-filter=A` confirme qu'il
  n'a **jamais** été tracké. Seul `docker/docker-compose.yml` l'est. Rien à faire.

- ~~Demandes de réservation directe qui n'expirent jamais~~ — **vrai en effet, faux en cause
  [vérifié], et ça remonte d'un cran.** Le cron **existe** (`service-requests.cron.ts:12`,
  `*/5 * * * *`), son prédicat SQL est correct
  (`service-request.repository.ts:541`), l'index composite est en place depuis la migration
  d'origine. Ce qui manque est **l'écrivain** : `create-request-form.tsx` n'envoie jamais
  `responseDeadlineUtc`, le champ du DTO est optionnel, donc la colonne est **toujours `NULL`**
  et le prédicat ne matche jamais.

  Conséquence visible : `formatDeadline()` (`dashboard/page.tsx:76`) reçoit `null` et rend
  `null` — **le compte à rebours construit en 3.12-front n'a jamais été affiché une seule
  fois.** Le correctif est un champ au front ou un défaut serveur, pas une infra à bâtir. Ça le
  fait **monter** dans la liste plutôt que descendre : une demande `OPEN` qui n'expire jamais
  encombre l'inbox du prestataire indéfiniment, et c'est l'écran qu'un artisan recruté regarde
  en premier.

---

## 5. Le risque de méthode, et c'est le plus important de la revue

**La base de CC repart de zéro à chaque session. La tienne a une histoire.**

Trois défauts réels n'ont été trouvés que sur ta base :
- le verrou `REJECTED` **affiché** au prestataire (session 9) ;
- le droit d'évaluer qui **mourait 72 h** après le travail, invisible en bac à sable parce que
  `COMPLETED → PAID` y est inatteignable ;
- l'écart entre « jamais évalué » et « désévalué » sur les cartes.

Ce n'est plus une coïncidence : **une base sans passé ne peut pas révéler les bogues
d'historique**, qui sont exactement ceux que de vrais utilisateurs produisent.

**Recommandation : une base de recette persistante**, qui accumule de l'état d'une session à
l'autre et sur laquelle CC (ou toi) rejoue avant chaque merge.

Corollaire immédiat : **il manque une fixture « prestataire noté »** reproductible
**[vérifié — trois seeders existent (`quebec-catalog`, `verified-regulated-trade`,
`completed-service-request`), aucun ne produit de prestataire noté, et `apps/api/package.json`
n'a aucun script `seed:*`]**. Le smoke de la tranche 3 a tourné sur un script jetable non
commité — personne ne peut recréer cet état.

### La cause est plus large que la base de recette

**[vérifié] Il n'y a aucune CI** — pas de `.github/workflows`. Et la couverture automatisée
tient en **quatre fichiers de spec** : `refunds.service`, `service-providers.service`, `money`,
`fixed-window-counter`.

Ce qui **n'a aucun spec** : `payments.service` — la capture du dépôt et du solde —,
`service-requests.service`, `auth`, `reviews.service`.

Autrement dit : **les deux points classés ① et ③ de cette revue vivent dans la seule zone du
dépôt sans couverture automatisée, et il n'existe aucune CI pour l'exécuter.** Une base de
recette persistante répond à la classe *bogue d'historique* ; elle ne fait rien contre une
régression sur le chemin de l'argent. Les deux manques sont distincts et se cumulent — c'est
le vrai contenu du « le point faible reste l'environnement » du §7.

Ordre suggéré, du moins cher au plus cher : une CI qui fait tourner `build` + `jest` sur
chaque PR (il n'y a rien aujourd'hui, donc le premier pas est presque gratuit), **puis** des
specs sur `payments.service` avant de toucher ① et ③, **puis** la base de recette.

---

## 6. L'ordre que je recommande

**Décide d'abord ce que « premier utilisateur réel » veut dire.** Deux stratégies très
différentes :

- **(a) Côté offre d'abord.** Recruter deux ou trois vrais prestataires, leur faire passer
  l'inscription complète, et faire les premières transactions avec des gens que tu connais.
  Ça teste la friction d'inscription réelle sans exiger que tout soit parfait.
- **(b) Une vraie transaction entre inconnus.** Exige tout ce qui précède.

**Je recommande (a)**, et ça fixe l'ordre :

1. **⑤** — limitation de débit sur `login`. Une demi-journée, mécanisme déjà écrit, et ça doit
   tomber avant le premier vrai compte.
2. **①** — onboarding Connect. Sans lui, (a) ne tient pas une journée. Front seul.
3. **②** — courriels **et réinitialisation de mot de passe, dans le même lot**. Un prestataire
   recruté qui n'est jamais prévenu se désabonne mentalement en une semaine ; un prestataire
   verrouillé hors de son compte est perdu tout de suite.
4. **La couche légale (§3)**, en parallèle, parce qu'elle ne dépend d'aucun code et que son
   délai n'est pas le tien.
5. **Le délai de réponse (§4, corrigé)** — un champ, et l'inbox cesse de s'encombrer.
6. **④** — le canal, dans sa forme tranchée.
7. **③** — l'arbitrage du dépôt, dès que ① existe — précédé des specs sur `payments.service`.
8. **§5** — CI d'abord, specs du chemin de l'argent ensuite, base de recette en continu.

**La messagerie (④) n'est pas le prochain chantier**, même si c'est le plus visible. Son
absence ne bloque aucun parcours ; l'absence d'encaissement bloque le seul qui compte.

---

## 7. Une dernière chose, sur la boucle elle-même

Elle a bien fonctionné. CC a corrigé le brief plus souvent qu'il ne l'a suivi aveuglément —
le binaire A/B mal posé de la session 9, le patron d'autorisation avec contournement ADMIN,
le `CHECK` qui ne rejette pas `3.5`, le droit d'évaluer mort à 72 h. **Chacune de ces
corrections venait de la recon, pas de la spécification.**

Ce qui l'a rendue sûre n'était pas la liste d'interdits — c'était « une session, une PR »,
le fichier d'état, et la porte humaine sur les migrations. Les trois ont tenu, sauf une fois
(trois PR en une session), signalée plutôt que dissimulée.

**Le point faible reste l'environnement, pas le jugement** : Docker absent, `git` local
bloqué, état distant faux à trois reprises, base sans histoire, **aucune CI, et le chemin de
l'argent sans un seul test**. C'est là qu'il faut investir si tu continues.
