# Arrêt d'urgence sans déploiement (Caddy)

Deux drapeaux, un fichier chacun, dans `/opt/linkr/flags/` sur le VPS. Poser ou retirer le fichier suffit : **ni rechargement, ni redémarrage, ni déploiement.** Le matcher `file` de Caddy fait un `stat` à chaque requête (vérifié : drapeaux posés et retirés pendant que Caddy tourne, voir le banc ci-dessous).

| Drapeau | Effet | Réponse |
|---|---|---|
| `signups-closed` | Fermer les inscriptions | `GET /signup` → 503, page statique en français. `POST /api/auth/signup` (le relais Next) → 503, JSON `{"message": "Les inscriptions sont temporairement fermées…"}`. Le reste du site est inchangé (connexion comprise). |
| `maintenance` | Tout fermer | Toute requête → 503, page statique « Linkr est en maintenance » (`Retry-After: 600`). **Prime** sur `signups-closed`. |

**Le webhook Stripe (`POST /webhooks/stripe*`) reste joignable dans les deux cas** : son `handle` précède les drapeaux dans le Caddyfile. Les autres méthodes sur ce chemin (`GET`…) reçoivent le 503 en maintenance.

Absent = comportement inchangé. Le dossier `flags/` est monté en lecture seule dans le conteneur : seul l'exploitant, sur l'hôte, pose les drapeaux.

Pour retirer un avis, une photo, suspendre un compte ou annuler une demande après avoir fermé les inscriptions : [moderation-sql.md](moderation-sql.md).

## Commandes (sur le VPS, depuis `/opt/linkr`)

```bash
# Fermer les inscriptions            # Les rouvrir
touch flags/signups-closed           rm flags/signups-closed

# Maintenance (tout en 503)          # La lever
touch flags/maintenance              rm flags/maintenance

# Vérifier (aucun drapeau → 200 ; posé → 503)
curl -s -o /dev/null -w '%{http_code}\n' https://linkrapp.com/signup
curl -s -o /dev/null -w '%{http_code}\n' https://linkrapp.com/
```

⚠️ **Fermer les inscriptions ne ferme pas l'API.** Le relais web `/api/auth/signup` est bloqué à Caddy ; l'API, elle, n'est joignable que par le réseau Docker. Les comptes existants se connectent normalement.

⚠️ **En maintenance, les relais web (`/api/*`) répondent aussi 503** : les utilisateurs connectés voient l'erreur sur leurs actions en cours. Les paiements Stripe déjà engagés se finalisent par le webhook, qui reste servi.

## Rouvrir un plafond de courriels de confirmation atteint (mandats L1 et A)

Depuis le mandat A, l'inscription n'envoie **aucun** courriel : le courriel de confirmation part au clic sur le bouton du bandeau (`POST /auth/verify-email/resend`). Un seul plafond quotidien, `EMAIL_VERIFICATION_DAILY_BUDGET` (60), couvre tous ces envois ; à l'intérieur, les renvois (tout envoi qui n'est pas le premier du jour pour ce compte) sont limités à `EMAIL_VERIFICATION_RESEND_DAILY_BUDGET` (20). Au plafond, le bouton répond 503 (« Les envois sont saturés aujourd'hui ») jusqu'à minuit, heure de Toronto ; l'inscription, elle, n'est plus bloquée.

Journaux à surveiller : `ALERT: 31 email verification sends before noon` (plus de 30 envois avant midi, heure de Toronto : souvent un script ; un par jour au plus), `Email verification budget at 48/60` (80 %), `… budget exhausted` et `… resend budget exhausted` (plafonds atteints, un par jour chacun). En cas d'alerte, regarder les inscriptions récentes (`docs/deploy/moderation-sql.md`) et, si besoin, fermer les inscriptions (drapeau `signups-closed` ci-dessus).

Pour rouvrir avant minuit, **supprimer la clé du jour** :

```bash
JOUR=$(TZ=America/Toronto date +%F)
docker compose exec redis redis-cli DEL "linkr:email-verification-budget:v2:$JOUR"
# sous-plafond des renvois, si c'est lui :
docker compose exec redis redis-cli DEL "linkr:email-verification-resend-budget:v2:$JOUR"
```

⚠️ **Jamais `FLUSHDB` ni `FLUSHALL`** : la même base Redis porte les files BullMQ (courriels en attente, webhooks Stripe) et le cache de géocodage. Rouvrir le plafond consomme le quota Brevo du jour (300 sur le plan gratuit) : vérifier la marge avant (`docs/deploy/env.md`).

## Première mise en place (à recopier sur le VPS, dans cet ordre)

Le Caddyfile et le compose changent : `deploy.sh` ne les met pas à jour (il ne tire que les images).

1. `ssh vps 'mkdir -p /opt/linkr/flags'` (sinon Docker crée le dossier sous root à la première montée).
2. `scp deploy/Caddyfile deploy/compose.yaml vps:/opt/linkr/` (les deux ensemble : le compose monte `./flags`, le Caddyfile le lit).
3. `ssh vps 'cd /opt/linkr && docker compose up -d caddy'` : recrée le conteneur Caddy avec le nouveau montage et recharge la configuration. Interruption de quelques secondes.
4. Vérifier : `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile` puis les `curl` ci-dessus (200 sans drapeau).
5. Optionnel : essayer `touch flags/signups-closed`, `curl`, `rm flags/signups-closed`.

`deploy/tests/arret-urgence.test.sh` recopie ces vérifications en local (Docker requis, Caddyfile de production, upstreams factices) : sans drapeau, `signups-closed`, `maintenance`, les deux, retrait, et webhook dans chaque mode.
