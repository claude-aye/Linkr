# HANDOFF — 5 novembre 2026 (nuit du 4 au 5) → session « Pour les premiers testeurs »

Session du 1er au 4 novembre : tests automatisés, parcours de paiement, purge des comptes e2e, droit à l'effacement et version légale `2026-11-05`.
Suite de `HANDOFF_2026-11-01_FIN.md` (§3 procédures, §6 dettes), dont le contenu reste valable sauf mention contraire.

**État de `main`** : `af85fb3bca17bc0a96c2c4e7e74e8e42ff1ed59f` (#172). **Déployé en production : le même SHA.**
**Site** : https://linkrapp.com (version d'essai, Stripe en mode test). **Aucun testeur réel inscrit.** L'adresse n'a pas été partagée : le but de la prochaine session est de préparer la publication d'un post LinkedIn ouvert au public.

---

## 1. Livré depuis le 1er novembre

| PR | Contenu |
|---|---|
| #165 | Seed du catalogue rejouable en production (`seed-catalog`, profil `tools`) : fichier = source de vérité, slugs jamais renommés, `regulation_level` et exigences non modifiés silencieusement. 7 métiers, 19 services, 7 exigences. |
| #166–#168 | Tests de fumée Playwright A–F (`e2e/`, paquet autonome hors workspace, son propre `pnpm-lock.yaml`). |
| #169 | Parcours de paiement e2e (`pnpm test:paiement`, exige `E2E_ALLOW_PAYMENT=1`) ; comptes e2e à adresses fixes. |
| #170 | Plus aucune adresse courriel dans les journaux de l'API (CLAUDE.md §13 nº 19). |
| #171 | Purge ciblée des comptes e2e (mode A) : `deploy/purge.sh`, service `purge`, rôle Postgres `linkr_purge`. Deux relectures indépendantes. |
| #172 | Droit à l'effacement pendant l'essai (option B) : textes légaux FR/EN, `LEGAL_VERSION` et `CURRENT_TERMS_VERSION` = `2026-11-05`, ÉFVP §7/§8, procédure de fermeture manuelle `deploy/close-account.sh`. |

**Hors code (fait à la main)** : adresses `e2e-prestataire@linkrapp.com` et `e2e-client@linkrapp.com` (Cloudflare Email Routing → boîte Gmail du soutien, catch-all désactivé) ; onboarding Stripe Connect du prestataire e2e (données de test) ; rôle `linkr_purge` créé, `PURGE_DATABASE_URL` dans `/opt/linkr/.env` (mot de passe dans Bitwarden) ; fichiers copiés sur le VPS : `purge.sh`, `compose.yaml`, `close-account.sh`, `close-account/`.

## 2. Vérifié en production

- Catalogue : « Mes métiers » affiche les 7 métiers. Tests de fumée A–F : 6/6 (dernier passage après #172).
- Parcours de paiement e2e passé : carte de test, acompte, solde, **webhook `payment_intent.succeeded` en 200**, statut « Payée ». Les 3 courriels du parcours arrivent (pas dans les indésirables).
- Sauvegardes nocturnes (08:00 UTC) vérifiées sur 3 nuits ; Healthchecks testé dans les deux sens (échec = courriel DOWN en 1 minute).
- Purge e2e réelle exécutée : 13 lignes, 2 anciens comptes `e2e+…@gmail.com` supprimés, comptes fixes intacts, catalogue inchangé.
- **Répétition de fermeture** : compte jetable « Essai » (inscription avec la nouvelle version légale OK), prestataire + 1 photo, simulation puis `--execute` : compte masqué, session invalidée, fichier supprimé du volume, connexion refusée, profil absent de la recherche. Registre tenu sur le poste (hors dépôt, sans courriel ni nom).

## 3. Procédures (rappel)

**Déployer** : voir HANDOFF 1er nov §3 (`gh pr checks N`, `git diff origin/main origin/BRANCHE --stat`, `gh pr merge N --squash --delete-branch`, workflow « Production images » vert sur `main`, `git rev-parse origin/main`, puis sur le VPS `cd /opt/linkr && ./deploy.sh <SHA_COMPLET>`). Si `deploy/compose.yaml` ou `Caddyfile` changent, les recopier d'abord (`scp`). Répondre `n` aux invites « Deletion of directory… ».

**Tests e2e** (PowerShell, depuis `C:\Dev\Linkr\e2e`) : `pnpm test` (6 tests de fumée) ; paiement : `$env:E2E_ALLOW_PAYMENT = "1"` puis `pnpm test:paiement`, puis `Remove-Item Env:E2E_ALLOW_PAYMENT`. Ne jamais lancer la purge pendant `test:paiement`. Les traces d'échec (`e2e/test-results/`) ne se committent jamais.

**Purge e2e** : `cd /opt/linkr && ./purge.sh` (simulation) puis `./purge.sh --execute` (sauvegarde, témoin, phrase tapée à la main). Doc : `docs/deploy/purge.md`. Après chaque purge : liste Stripe à traiter à la main, puis `shred -u`.

**Fermeture de compte sur demande** : `docs/deploy/fermeture-compte.md` (identité par retour de courriel à l'adresse exacte ; `./close-account.sh <users.id>` en simulation, puis `--execute`, phrases `FERMER <id>` et `SUPPRIMER <n> FICHIERS` ; Stripe, Brevo, Gmail et registre à la main). Refuse un ADMIN, un compte e2e fixe, un compte avec demande/paiement/devis en cours.

## 4. Décisions verrouillées

- **Aucun agent n'écrit en production** (ni Claude Code sur le VPS). Une surveillance en lecture seule pourra être étudiée plus tard.
- **Bac à sable Stripe PARTAGÉ avec le développement** : JAMAIS « Supprimer toutes les données de test ». Supprimer à la main uniquement des identifiants listés (`cus_`, `pm_`, `acct_`). Fixtures de dev à ne pas toucher (Alice, Carol) ; compte Connect du prestataire e2e à conserver.
- Purge : D1/D2 destruction, D3 comptes e2e fixes gardés (seules leurs transactions partent), D4 ADMIN jamais supprimé, D6 arrêt si le catalogue référence un utilisateur, D9 rôle `linkr_purge`, D12 liste e2e codée dans le script. Le script ne tourne jamais par cron ni par un agent ; simulation par défaut ; le témoin de sauvegarde protège de l'erreur d'usage, pas d'un shell malveillant.
- Droit à l'effacement : **option B** (masquage immédiat à la main + destruction totale à la purge de fin d'essai). Pas d'anonymisation : **mode C codé = condition ferme avant la production**.
- Règle de version légale (§13.1 nº 31) : changement de fond = nouvelle version. **Dès la première invitation envoyée, tout changement des textes légaux s'accompagne d'un avis aux inscrits** (préavis de 30 jours pour un changement important des conditions). Donc **tout changement légal voulu doit être fait AVANT le post**.
- Inscription **ouverte au public** (pas de codes d'invitation). Canal de retour : `support@linkrapp.com`. **Aucune date de fin d'essai.**
- **Règle** : ne pas annoncer la fin de l'essai tant que la purge de fin d'essai (mode B) n'a pas été écrite et répétée.
- Méthode : une PR = une responsabilité ; CC ne merge jamais ; CLAUDE.md mis à jour dans la même PR ; **la CI Linux fait foi** (tester dans un conteneur Linux les PR qui touchent fichiers, chemins ou scripts shell) ; mandats en deux phases (reconnaissance puis code) pour tout ce qui touche données personnelles ou paiements ; relecture indépendante (Opus, lecture seule) pour le code qui détruit des données. Sonnet pour le mécanique, Opus pour le jugement.

## 5. Conformité : où en sont les cases (ÉFVP §8)

- **OVHcloud** : accord de traitement (Hébergement OVH Inc., 26.05.2023, droit québécois) lu : usage limité, sécurité, avis d'incident, suppression sous 30 jours après la fin du service, audit. VPS à Beauharnois. Fermable.
- **Stripe** : contrat de traitement en vigueur (28 sept. 2026) intégré à ton contrat de services. Le « Supplier DPA » du dossier de preuves ne te concerne pas : le retirer du dossier.
- **Cloudflare, Google** : adhésion au Data Privacy Framework « Active » (captures). Lieux de traitement non documentés.
- **Brevo** : DPA dans l'Annexe 3 des CGU (version du 1er oct. 2025), accepté à l'ouverture du compte. Réserves à noter dans l'ÉFVP : DPA rédigé sous le RGPD (pas la Loi 25) ; partie contractante Brevo Inc. (États-Unis) pour les clients canadiens ; hébergement UE de TON compte non prouvé. Décision : « acceptée pour l'essai », à rouvrir avant la production (avis juridique recommandé). Console : aucun contact créé par l'app.
- **Healthchecks.io** : serveurs Hetzner en Allemagne selon une fiche d'annuaire et une page tierce (société lettone SIA Monkey See Monkey Do) ; **à confirmer sur la liste des sous-traitants de healthchecks.io/privacy**. Le signal ne contient aucune donnée personnelle.
- **MapTiler** : clé unique restreinte à `linkrapp.com` (écart assumé pour l'essai) ; clé distincte avant la production.
- **OVH — sauvegarde automatique du VPS (point nouveau, à trancher)** : l'espace client montre « Backup automatisé — Standard », 1 entrée (4 nov. 04:29). Selon la documentation OVHcloud, la Standard est une copie quotidienne avec **rétention de 24 h** (Premium : 7 jours glissants). C'est une **copie complète du disque du VPS (base et fichiers en clair)** qui n'est **mentionnée nulle part** dans la politique ni l'ÉFVP, lesquelles ne parlent que des sauvegardes chiffrées de 14 jours. Options : (a) la déclarer dans la politique et l'ÉFVP (nouvelle version légale, à faire AVANT le post) ; (b) voir si l'option peut être désactivée dans l'espace client (la Standard est annoncée « incluse sur toutes les offres », donc pas sûr). Recommandation : (a). À vérifier le lendemain de la purge que la date de l'entrée a bien changé (remplacement quotidien).

## 6. À faire avant de publier le post (ordre proposé)

1. **Reconnaissance « modération et abus » (CC, Opus, lecture seule)** : mandat en §8. Elle conditionne ce qu'on promet aux inconnus qui s'inscriront.
2. **Page « Guide du testeur »** (PR petite, Sonnet, effort faible) : texte en §9, liée depuis le bandeau d'essai. Elle ne doit rien promettre de plus que la politique (sinon nouvelle `LEGAL_VERSION`).
3. **PR légale + ÉFVP** (une seule, nouvelle `LEGAL_VERSION`) : copie complète du VPS (24 h, remplacée chaque jour), réserves Brevo, Healthchecks (après confirmation), Stripe DPA, retrait du « Supplier DPA » du dossier de preuves. Ajouter le correctif de la phrase sur les journaux du serveur si la politique §2 les surestime (dette).
4. Corrections éventuelles issues de la reconnaissance (0 à 3 PR).
5. Brouillon du post en §10, publication.

**Après le post (pas bloquant)** : purge de fin d'essai (mode B, « P2 ») ; anonymisation codée (mode C) avant la production ; correctifs de la liste de dettes (§7).

## 7. Dettes ouvertes (nouvelles ; les anciennes sont dans HANDOFF 1er nov §6)

- **Avant la production** : anonymisation codée (mode C) ; `GET /service-providers/{id}/reviews` répond encore pour un prestataire fermé (un utilisateur connecté qui connaît l'id peut lire ses avis) ; avis d'un compte fermé visibles sous « — » ; portabilité sans endpoint d'export ; valeur « province » jamais demandée ; `DELETE /users/me` sans écran et sans masquage du prestataire ; aucun mécanisme de re-acceptation des conditions ; clé MapTiler distincte ; boîte de soutien payante hébergée au Canada ; Brevo (DPA RGPD, partie américaine) ; avis juridique sur les textes.
- **Webhook Stripe** : la destination écoute 5 événements (`payment_intent.succeeded`, `payment_failed`, `canceled`, `charge.refunded`, `account.updated`), le code en traite 6 (dont `payment_intent.processing` et `refund.updated`, non écoutés ; `canceled` non traité) ; `account.updated` est un événement Connect que l'API ne sait pas vérifier sur ce point de terminaison (la page de retour de Stripe synchronise l'état). PR de code séparée.
- **Purge / fermeture** : M3, M6 (la sonde est embarquée dans l'image de production), M7, M8, M9, M-f (voir `docs/deploy/purge.md`) ; `close-account.sh` tourne avec le rôle propriétaire de la base (rôle dédié plus strict) ; épingler l'image `alpine:3.20` par empreinte (digest) ; `beforeAll` de contournement dans `purge-exit.spec.ts`.
- **Produit** : le géocodeur propose Montréal avant Québec pour « Place d'Youville » ; message « La liste des métiers n'a pas pu être chargée » s'affiche aussi quand le catalogue est vide (`dashboard/page.tsx` ~l.1366) ; liens « Voir mes paiements → » et « Retour à mon espace pro » mal alignés sur la page « Retour de Stripe » ; lien « Voir le fichier » de la console admin cassé ; CSP absente ; IPv6 sans `AAAA`.
- **Outillage** : lint (flat-config) ; jest complet qui s'est bloqué une fois une heure avant de passer avec `--forceExit` (ressource ouverte non identifiée) ; anciens worktrees `Linkr-f1` et `Linkr-f2` (Permission denied) ; base de dev « Input/output error » possible ; jeton GHCR expire le 2027-01-29.
- **Données e2e** : les anciens courriels `e2e+…@gmail.com` sont arrivés dans la boîte d'un inconnu (irrattrapable) ; les comptes e2e fixes restent visibles en recherche (voir mandat §8).

## 8. Mandat prêt : reconnaissance « modération et abus » (Opus, effort élevé, LECTURE SEULE)

```
MANDAT — Préparer l'ouverture au public de la version d'essai : modération et abus (RECONNAISSANCE, AUCUN FICHIER MODIFIÉ)

Contexte
La version d'essai (https://linkrapp.com, Stripe en mode test) va être ouverte à toute personne qui tombe sur un post LinkedIn : inscription libre, sans vérification de courriel, sans nombre de testeurs ni date de fin. Je ne suis pas juriste : n'invente aucune affirmation juridique. Tu ne codes rien ; tu me rends des options et une recommandation.

À examiner dans le code et la documentation (chemins et lignes précises) :
1. Pouvoirs d'un ADMIN aujourd'hui : routes et écrans. Peut-il retirer une photo de portfolio, un avis, un document de vérification ? Désactiver ou fermer un compte ? Lister les inscriptions récentes ? Que fait le lien « Voir le fichier » de la console admin (cassé : l'API n'est pas joignable par le navigateur) ? Que manque-t-il pour réagir en moins d'une heure à un contenu abusif ?
2. Surface d'abus d'une inscription libre sans courriel vérifié : usurpation d'adresses (courriels envoyés par la plateforme à des tiers : réservations, acceptations, réinitialisations), contenus libres (titres, descriptions, bios, avis, noms d'affichage : échappement, longueur, liens), téléversements (types, tailles, EXIF, quotas par compte), limites de débit (inscription 10/h, connexion 30/h par IP : suffisantes ?), usage des services externes par des inconnus (Nominatim côté serveur à 1 req/s, MapTiler : quota de la clé gratuite), file de courriels Brevo (plafond d'envoi du compte).
3. Pollution du bac à sable Stripe PARTAGÉ avec le développement : chaque inconnu qui configure un paiement crée des clients ou comptes Connect dans ce bac à sable. Impact sur les fixtures de dev, limites, nettoyage.
4. Le prestataire e2e fixe est visible en recherche (Coiffure, autour de la place d'Youville, Québec) : un vrai testeur peut le réserver. Options pour l'éviter SANS casser les tests e2e (indicateur d'exclusion, éloignement, autre) et ses effets sur la purge (contrôle de fermeture).
5. Observabilité : comment saurai-je, sans SSH, qu'un grand nombre d'inscriptions arrive, qu'une erreur 5xx se répète, qu'un compte envoie des courriels en rafale ? Que montrent les journaux Docker (rotation 10 Mo × 3) ? Options minimales en lecture seule.
6. Arrêt d'urgence : comment fermer les inscriptions ou mettre le site en maintenance en quelques minutes (Caddy, variable d'environnement, drapeau), sans perdre de données et sans déployer ?
7. Données volumineuses : que se passe-t-il si 500 comptes s'inscrivent ? Espace disque (volume uploads, base, journaux), sauvegardes nocturnes (durée, taille), limites du VPS-2.

Livrable : rapport classé par gravité (bloquant avant le post / à faire vite après / dette), chaque point avec fichier et ligne, scénario concret, options avec coût en PR, recommandation. Aucune modification de fichier, aucune requête contre la production, aucun secret dans le rapport. Ne merge rien.
```

## 9. Texte prêt : page « Guide du testeur » (FR ; PR Sonnet, effort faible, liée depuis le bandeau d'essai)

Mandat à CC : créer une page publique `/guide-testeur` (FR ; EN seulement si le site a déjà un mécanisme de traduction pour ses pages), reprenant exactement ce texte, sans aucune promesse de plus que la politique de confidentialité (§13.1 nº 31). Éviter les mots interdits par CLAUDE.md (« gratuit », « sécurisé », « vérifié »). Lien depuis le bandeau « Version d'essai ». Pas de migration, pas de nouvelle donnée personnelle.

> **Guide du testeur**
>
> Linkr est en version d'essai. Vous pouvez l'essayer comme client (chercher un prestataire près de chez vous, envoyer une demande) ou comme prestataire (déclarer un métier, ajouter un service, recevoir et exécuter une demande).
>
> **Les paiements sont fictifs.** Ils sont en mode test : aucune somme réelle n'est prélevée. Pour ajouter une carte, utilisez la carte de test 4242 4242 4242 4242, avec une date d'expiration future et un code de sécurité de votre choix. N'entrez jamais vos vraies informations bancaires.
>
> **Configurer les paiements d'un prestataire** : la page de Stripe propose des données de test. Utilisez-les : n'entrez jamais vos vraies informations d'identité ou bancaires.
>
> **Vos renseignements** : ils sont conservés tant que votre compte existe. La fin de l'essai sera annoncée sur le site et par courriel, et toutes les données de l'essai seront effacées au plus tard 30 jours après la fin. Vous pouvez demander la fermeture de votre compte à tout moment (voir la politique de confidentialité, section 7).
>
> **Nous écrire** : support@linkrapp.com. Dites-nous la page où vous étiez, ce que vous faisiez, ce que vous attendiez et ce qui s'est passé. Une capture d'écran aide, sans renseignement personnel.

## 10. Brouillon du post LinkedIn (à valider après §6)

> Je lance une version d'essai de Linkr, une plateforme qui met en relation des clients et des prestataires de services au Québec (plomberie, électricité, menuiserie, coiffure, esthétique, décoration, homme à tout faire). Je cherche des gens pour l'essayer, côté client comme côté prestataire, et me dire ce qui fonctionne et ce qui accroche.
>
> À savoir avant de vous inscrire :
> • C'est une version d'essai : les paiements sont en mode test, aucune somme réelle n'est prélevée. Pour payer, utilisez la carte de test 4242 4242 4242 4242, avec une date future et un code de votre choix.
> • N'entrez jamais vos vraies informations bancaires ou d'identité : pour la configuration des paiements d'un prestataire, saisissez des valeurs fictives.
> • Vos renseignements sont détruits au plus tard 30 jours après la fin de l'essai, qui sera annoncée sur le site et par courriel. Vous pouvez demander la fermeture de votre compte à tout moment.
> • Vos commentaires et vos demandes : support@linkrapp.com
>
> linkrapp.com

## 11. Rappels de méthode

- Aucun secret (clé, jeton, mot de passe) dans Git ni dans une conversation. Valeurs dans Bitwarden et `/opt/linkr/.env`.
- Ne jamais lancer `pnpm test` ni `pnpm test:paiement` entre une simulation de purge et son exécution (l'empreinte changerait).
- Les anciens comptes e2e et le compte jetable « Essai » (fermé) n'ont plus d'usage ; ils partent à la purge de fin d'essai.
- Demander à CC un conteneur Linux (`node:22-bookworm-slim`) pour toute PR qui touche au système de fichiers.

## 12. Première question de la session

Lancer d'abord la reconnaissance « modération » (§8) pendant qu'on rédige la PR légale (§6 nº 3) et la page Guide du testeur. Décision à reprendre : OVH sauvegarde Standard, option (a) ou (b) du §5, avant de rédiger la PR légale.
