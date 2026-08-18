# JOURNAL — Travail autonome CC

Une ligne par PR mergée, la plus récente en tête. C'est la piste d'audit à lire pour
rattraper une absence.

| Date | PR | Chantier | Migration | Ce qui a changé | Dette |
|---|---|---|---|---|---|
| 2026-08-18 | [#73](https://github.com/claude-aye/Linkr/pull/73) | H-1 | — | L'accueil devient l'entrée **par métier** (7 tuiles → `/recherche?categoryId=`) ; l'état vide distingue « personne n'exerce ici » de « personne n'est encore vérifié » ; une recherche sans localisation dégrade explicitement au lieu de finir en cul-de-sac | 1 créée (le lien d'échappement de l'accueil disparaît avec le catalogue ; la nav le porte). ⛔ 1 décision en attente : durée de conservation, tranche 2 |
| 2026-08-17 | [#72](https://github.com/claude-aye/Linkr/pull/72) | G-1 | — | Nav `(app)` : cibles tactiles 20 px → 44 px (0 sous le plancher WCAG, contre 3/5), retour à la ligne épinglé, « Déconnexion » n'est plus seule sur sa ligne ; desktop inchangé | Aucune créée. Arbitrage : +18 px d'en-tête à 414 px, +10 px ≥ 768 px. ⛔ 1 décision de copie en attente |
