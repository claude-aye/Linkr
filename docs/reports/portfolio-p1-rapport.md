# Portfolio P1 — rapport

Branche `feat/portfolio-p1` (depuis `main` à `30b6f5a`). Recon :
`docs/reports/portfolio-p1-recon.md`. **`payments` non touché.** Aucune condition
d'arrêt rencontrée.

## Ce qui est livré

- **Migration `1780550000000-CreatePortfolioItems`** : table `portfolio_items`
  (colonnes du mandat), index partiel `(service_provider_id, position) WHERE
  deleted_at_utc IS NULL`, `storage_key` unique, `CHECK` sur la légende (1 à 140
  caractères, `NULL` pour « pas de légende »), la position (≥ 0) et les dimensions
  (> 0), FK `ON DELETE RESTRICT`. **Pas** d'unicité sur `position`. Miroirs
  d'entité posés. **À jouer par Ayé** (smoke ci-dessous). Prouvée
  `run → revert → run` sur la base jetable `linkr_portfolio_probe`, garde
  migrations verte, `migration:generate` en simulation : seul le bruit connu de
  renommage de FK.
- **Module `portfolio`** (API) : processeur d'image, dépôt, service, trois
  contrôleurs.
- **Relais web** `apps/web/src/app/media/portfolio/[itemId]/route.ts` et
  ouverture de `/media/portfolio/*` dans `proxy.ts`.
- **Constantes miroir** API ↔ web, ajoutées à la garde.
- **Contrat** régénéré en démarrant l'app : `openapi.json` +419/−0,
  `schema.d.ts` +432/−0, aucune route existante modifiée, aucun
  `Record<string, never>`, aucune clé de stockage.

## Routes

| Méthode | Chemin | Accès | Réponses |
|---|---|---|---|
| GET | `/service-providers/me/portfolio` | prestataire | 200 `{ items }`, 404 sans profil |
| POST | `/service-providers/me/portfolio` | prestataire | 201, 400, 404, 409 `PORTFOLIO_LIMIT_REACHED`, 413, 415, 422 |
| PATCH | `/service-providers/me/portfolio/:itemId` | prestataire | 200, 400 (`{}` ou > 140), 404 |
| PUT | `/service-providers/me/portfolio/order` | prestataire | 200, 400 (forme), 422 (ensemble inexact) |
| DELETE | `/service-providers/me/portfolio/:itemId` | prestataire | 204, 404 |
| DELETE | `/admin/portfolio/:itemId` | admin | 204, 403, 404 |
| GET | `/service-providers/:id/portfolio` | public | 200 `{ items: [{ id, caption, width, height, imageUrl }] }`, 404 |
| GET | `/portfolio/:itemId/image` | public | 200 `image/webp` en flux, 404 |
| GET | `/media/portfolio/:itemId` (**web**) | public | relaie le précédent ; 404 si l'id n'est pas un uuid |

La photo d'un autre prestataire répond toujours **404**, jamais 403.

## Chaîne de traitement de l'image

Dans cet ordre (`PortfolioImageProcessor`) :

1. **Taille** : au-delà de 5 242 880 octets → 413, d'abord par multer, avant la
   lecture complète. ⚠️ `limits.fileSize` vaut `PORTFOLIO_MAX_BYTES + 1` : busboy
   déclenche la limite dès que le compte **atteint** `fileSize`. Avec `MAX`, un
   fichier de 5 Mo pile aurait été refusé (mesuré par la spec du contrôleur).
2. **Type réel** lu dans les octets par `sharp().metadata()` : `jpeg`, `png` ou
   `webp` seulement ; illisible, GIF ou image animée → 415.
3. **Pixels** : au-delà de 40 000 000 → 422, décidé sur l'en-tête, avant tout
   décodage. La lecture de l'en-tête se fait sans limite de pixels, sinon une
   image trop grande tomberait en 415 au lieu de 422.
4. **Ré-encodage** : `.rotate()` sans argument, avant `resize` ; `resize` 1600 px
   `inside` sans agrandir ; WebP qualité 82 ; aucune métadonnée (jamais
   `withMetadata` ni `keep*`). On enregistre `image/webp` et la taille et les
   dimensions **de la sortie**.

Puis : écriture du fichier sous `portfolio/{providerId}/{uuid}.webp`, puis
`INSERT` sous verrou. Si l'insertion échoue ou est refusée, le fichier est
supprimé (au mieux, avec un journal).

## Tests et mutations

- jest **600/600** (57 nouveaux : processeur 12, service 23, contrôleur 19,
  adaptateur de stockage 3). Ligne de base déduite : 543 (non remesurée sur `main`).
- Sonde `src/database/probes/portfolio.probe.ts` **44/44**, sur une base jetable.
- Web `node --test` **204/204** (8 nouveaux), typecheck, lint (0 erreur, 2
  avertissements préexistants), build (`/media/portfolio/[itemId]` en `ƒ`).
- Garde miroir : 11 constantes. Garde migrations : verte.

| Mutation | Effet observé |
|---|---|
| `.rotate()` retiré du processeur | test d'orientation rouge : 800 au lieu de 600 |
| `FOR UPDATE` retiré du dépôt | sonde rouge : 2 réussites et **13 photos** dès la 2ᵉ ronde |
| `PORTFOLIO_MAX_BYTES` côté web à 5 242 881 | garde miroir rouge, sortie 1 |

## Ce que la sonde a trouvé, et qui est corrigé

**`LocalDiskStorageAdapter.delete` avalait toute erreur d'`unlink`** et la
journalisait en « no-op for missing key », au niveau debug. Sous Windows, un
fichier encore ouvert n'est pas effacé (`EPERM`/`EBUSY`) : la suppression
échouait donc en silence en se disant réussie. Pour une photo qui doit cesser
d'exister (Loi 25), c'est inacceptable. Désormais, seule l'absence du fichier
(`ENOENT`) reste une non-erreur ; toute autre erreur remonte, et le service la
journalise avec la clé (`Portfolio file … could not be deleted …; remove it by
hand`). Le portfolio est le **premier** appelant de `delete` : aucun autre
comportement ne change. 3 tests dédiés.

## Smoke exécuté par l'agent (API de branche :5100, base jetable, Redis db 1, web en dev :3002)

- **Envois** : portrait JPEG orienté 6 avec GPS → **201**, sortie **900×1200**
  (debout) ; fichier stocké : WebP, sans EXIF, XMP ni IPTC, la chaîne
  `SmokePhone` absente des octets. Texte renommé `.jpg` → 415, GIF → 415,
  5 Mo + 1 → 413, 42 MP → 422, légende de 141 caractères → 400, pas de fichier →
  400, pas de jeton → 401.
- **Plafond** : photos 2 à 11 → 201 ; deux envois **simultanés** à 11 → **201 et
  409** (`code: PORTFOLIO_LIMIT_REACHED`) ; 13ᵉ → 409. En base : 12 lignes, 12
  positions (0..11). Au journal : 13 fichiers écrits, 12 photos créées ; sur le
  disque : 12 fichiers. Le perdant a passé le contrôle rapide, a été refusé par
  le compte sous verrou, et son fichier a été effacé.
- **Réordonnancement** : ensemble exact inversé → 200 (la dernière photo passe en
  tête) ; un id manquant, un id en double, un id en trop, la photo d'un autre
  prestataire → **422** ; pas des uuid → 400.
- **Légende** : `"   "` → `null` ; `PATCH {}` → 400.
- **Propriété** : Bob qui modifie ou supprime la photo de Dana → **404**. Admin :
  Bob → **403** ; admin → **204**, id de l'admin journalisé, image → 404.
- **Suppression** : 204 ; le fichier n'existe plus sur le disque ; image → 404
  par l'API et par le relais (`no-store`) ; absente des deux listes ; seconde
  suppression → 404.
- **Prestataire supprimé en douceur** : liste publique et image → 404.
- **Relais web, sans session** : 200, corps **identique octet pour octet** à
  celui de l'API, avec les quatre en-têtes et rien d'autre ; uuid invalide → 404 ;
  uuid inconnu → 404 ; `/media/other/x` → 307 (le proxy ne s'ouvre que pour le
  portfolio). Au navigateur : `image/webp`, 900×1200, **aucune requête** vers
  :5000 ni :5100.
- Les réponses JSON ne contiennent ni `storage`, ni `http`, ni port.

## Écarts au mandat, signalés

1. **Variable d'URL du relais.** Le mandat demande « la même variable d'URL
   interne que les relais BFF » **et** « aucun usage de `NEXT_PUBLIC_API_URL` ».
   La seule variable des relais **est** `NEXT_PUBLIC_API_URL`. Le relais passe
   donc par `getServerApiClient()` comme ses frères : il ne cite ni la variable ni
   le port (un test le vérifie dans la source), et la base reste résolue dans
   `lib/auth/session.ts`. Aucune variable nouvelle. Dette de déploiement notée.
2. **Visibilité publique.** « La même condition que `/providers/{id}` » est
   « existe et non supprimé ». Un prestataire **en pause** garde ses photos
   publiques, comme son profil.
3. **Légende.** Le `CHECK` exige aussi au moins 1 caractère : une légende vide est
   enregistrée `NULL`, jamais `''`.
4. **Enveloppes.** Les listes renvoient `{ items: [...] }` plutôt qu'un tableau nu
   (convention récente du dépôt, extensible sans casser le contrat).
5. **Dockerfile.** Le `apps/api/Dockerfile` réel échoue avant toute dépendance
   (défaut préexistant). `sharp` a été prouvé dans la même image de base
   (`node:20-alpine`) avec la même commande d'installation et le lockfile.

## Dettes (inscrites au §6 de `CLAUDE.md`)

Fichier orphelin si le stockage refuse la suppression (journalisé, nettoyage à
la main) ; pas de limitation de débit sur l'envoi ; `down()` ne supprime pas les
fichiers ; Dockerfile de l'API cassé ; pas d'URL interne de l'API distincte ;
lien navigateur vers l'API dans `admin/verifications`. Plus la dette demandée par
le mandat (demandes `COMPLETED` au solde `SUCCEEDED` sans webhook).

---

## Smoke humain (PowerShell, à copier)

Prérequis : Docker démarré, branche `feat/portfolio-p1` extraite,
`pnpm install --frozen-lockfile` fait à la racine.

### 1. Migration sur la base de dev, puis table vide

```powershell
Set-Location C:\Dev\Linkr\apps\api
pnpm migration:run
```

```powershell
"SELECT count(*) AS photos FROM portfolio_items;" | docker exec -i linkr-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Attendu : `CreatePortfolioItems1780550000000 has been executed successfully`, puis
`photos = 0`.

### 2. Démarrer l'API et le web, et obtenir un jeton pour Dana

```powershell
Set-Location C:\Dev\Linkr\apps\api; pnpm build; pnpm start
```

Dans un second terminal :

```powershell
Set-Location C:\Dev\Linkr\apps\web; pnpm dev
```

Dans un troisième terminal :

```powershell
$pw = Read-Host 'Mot de passe de dana@linkr.test'
$login = Invoke-RestMethod -Method Post -Uri http://localhost:5000/auth/login -ContentType 'application/json' -Body (@{ email = 'dana@linkr.test'; password = $pw } | ConvertTo-Json)
$tok = $login.accessToken
```

### 3. Envoyer une vraie photo de téléphone prise en portrait

Copier la photo (prise **en portrait**, le téléphone tenu debout) sous
`C:\Temp\portrait.jpg`, puis :

```powershell
curl.exe -s -X POST http://localhost:5000/service-providers/me/portfolio -H "Authorization: Bearer $tok" -F "file=@C:\Temp\portrait.jpg" -F "caption=Ma première photo"
```

Attendu : un JSON avec `"width"` **plus petit** que `"height"` (ex. `1200` ×
`1600`) et `"imageUrl":"/media/portfolio/…"`. Noter l'`id` :

```powershell
$id = (Invoke-RestMethod -Uri http://localhost:5000/service-providers/me/portfolio -Headers @{ Authorization = "Bearer $tok" }).items[0].id
```

### 4. Le fichier stocké n'a plus d'EXIF ni de GPS, et il est en portrait

```powershell
Set-Location C:\Dev\Linkr\apps\api
$key = ("SELECT storage_key FROM portfolio_items WHERE id = '$id';" | docker exec -i linkr-postgres sh -c 'psql -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB"').Trim()
node -e "const s=require('sharp');const b=require('fs').readFileSync(process.argv[1]);s(b).metadata().then(m=>console.log({format:m.format,width:m.width,height:m.height,exif:m.exif!==undefined,xmp:m.xmp!==undefined,iptc:m.iptc!==undefined}))" "storage/uploads/$key"
```

Attendu : `format: 'webp'`, `width < height`, `exif: false`, `xmp: false`,
`iptc: false`.

### 5. La photo s'affiche debout dans le navigateur

```powershell
"http://localhost:3001/media/portfolio/$id"
```

Ouvrir cette URL dans le navigateur (même déconnecté) : la photo s'affiche
**debout**.

### 6. Par le tunnel Cloudflared, sur le téléphone (si le tunnel est actif)

Ouvrir `https://<votre-tunnel>/media/portfolio/<id>` sur le téléphone : même
photo, debout. Le tunnel n'expose que le port 3001, et c'est suffisant : le
navigateur ne parle jamais à l'API.

### 7. La 13ᵉ photo est refusée, puis la suppression rend l'URL introuvable

```powershell
1..11 | ForEach-Object { curl.exe -s -o NUL -w "%{http_code} " -X POST http://localhost:5000/service-providers/me/portfolio -H "Authorization: Bearer $tok" -F "file=@C:\Temp\portrait.jpg" }
curl.exe -s -w " -> %{http_code}`n" -X POST http://localhost:5000/service-providers/me/portfolio -H "Authorization: Bearer $tok" -F "file=@C:\Temp\portrait.jpg"
```

Attendu : onze `201`, puis `409` avec `"code":"PORTFOLIO_LIMIT_REACHED"`.
(Si Dana avait déjà des photos, il y aura moins de `201` avant le `409`.)

```powershell
curl.exe -s -o NUL -w "DELETE -> %{http_code}`n" -X DELETE "http://localhost:5000/service-providers/me/portfolio/$id" -H "Authorization: Bearer $tok"
curl.exe -s -o NUL -w "relais -> %{http_code}`n" "http://localhost:3001/media/portfolio/$id"
Test-Path "C:\Dev\Linkr\apps\api\storage\uploads\$key"
```

Attendu : `DELETE -> 204`, `relais -> 404`, `False` (le fichier n'existe plus).

Pour remettre Dana à zéro après le smoke, supprimer ses photos restantes une par
une par la même route `DELETE`.
