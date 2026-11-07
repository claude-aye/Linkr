# Déplacer le prestataire e2e hors de la recherche publique

À exécuter **à la main** par l'exploitant, sur le VPS, avec `psql`. Ne jamais l'exécuter depuis un agent, une CI ou une tâche planifiée.

## Pourquoi

Le profil `e2e-prestataire-linkrapp` a été créé au Vieux-Québec avec un rayon de 25 km : un vrai testeur de la région le voit et peut le réserver. Ses demandes lient alors un compte réel à un compte e2e, et la purge (`purge-plan.ts`, contrôle de fermeture) s'arrête. Le profil passe à l'aéroport international Jean-Lesage (46.7922764, -71.3835922, point Nominatim du terminal), rayon 1 km.

La recherche (`discover`) lit le **centre de cellule** (environ 555 m de côté) de la base, jamais la base exacte : le cercle de 1 km est décalé d'au plus 390 m. Un client à plus d'environ 1,4 km du terminal ne voit pas ce prestataire.

## Ordre exact

1. Sauvegarde du jour valide (`deploy/backup/backup.sh`, ou celle de 3 h).
2. Exécuter le SQL ci-dessous (étapes A, B, C). Le profil est alors à l'aéroport.
3. Seulement ensuite, lancer `pnpm test` (et `pnpm test:paiement`) depuis `e2e/` avec la version de ce changement. Les tests supposent que le profil existe déjà (ils ne le recréent pas) et cherchent au même endroit.

Dans l'ordre inverse, le test E cherche à l'aéroport un prestataire encore au Vieux-Québec (15 km plus loin, hors du rayon) et échoue.

## SQL

```sql
-- A. Contrôle avant : doit rendre exactement 1 ligne.
SELECT sp.id, sp.business_name, sp.service_radius_km,
       ST_AsText(sp.service_base_location) AS base, sp.is_active
  FROM service_providers sp
  JOIN users u ON u.id = sp.user_id
 WHERE u.email = 'e2e-prestataire@linkrapp.com'
   AND u.first_name = 'e2e'
   AND u.deleted_at_utc IS NULL
   AND sp.business_name = 'e2e-prestataire-linkrapp'
   AND sp.provider_type = 'INDIVIDUAL'
   AND sp.deleted_at_utc IS NULL;

-- B. Mise à jour. Attendu : UPDATE 1.
BEGIN;
UPDATE service_providers sp
   SET service_base_location = ST_SetSRID(ST_MakePoint(-71.3835922, 46.7922764), 4326)::geography,
       service_radius_km = 1,
       updated_at_utc = now()
  FROM users u
 WHERE u.id = sp.user_id
   AND u.email = 'e2e-prestataire@linkrapp.com'
   AND u.first_name = 'e2e'
   AND u.deleted_at_utc IS NULL
   AND sp.business_name = 'e2e-prestataire-linkrapp'
   AND sp.provider_type = 'INDIVIDUAL'
   AND sp.deleted_at_utc IS NULL;

-- Contrôle dans la transaction : 1 ligne, rayon 1, POINT(-71.3835922 46.7922764).
SELECT sp.id, sp.service_radius_km, ST_AsText(sp.service_base_location) AS base
  FROM service_providers sp
  JOIN users u ON u.id = sp.user_id
 WHERE u.email = 'e2e-prestataire@linkrapp.com' AND sp.deleted_at_utc IS NULL;

-- Si le résultat n'est pas exactement celui attendu : ROLLBACK;
COMMIT;

-- C. Zones nommées : doit rendre 0 ligne (une zone élargirait la couverture,
-- `discover` lit aussi le polygone exact). Sinon, s'arrêter et les examiner.
SELECT z.id, z.zone_label
  FROM professional_service_zones z
  JOIN service_providers sp ON sp.id = z.service_provider_id
  JOIN users u ON u.id = sp.user_id
 WHERE u.email = 'e2e-prestataire@linkrapp.com';
```

Seuls `service_base_location`, `service_radius_km` et `updated_at_utc` d'une ligne changent. Retour arrière : même `UPDATE` avec l'ancien point (le Vieux-Québec, noté à l'étape A) et le rayon 25.

## Vérification

Une recherche « Coiffure » faite depuis une adresse du Vieux-Québec ou du centre-ville ne doit plus afficher `e2e-prestataire-linkrapp` ni sur la liste ni sur la carte (la carte ne montre que les résultats de `discover`).
