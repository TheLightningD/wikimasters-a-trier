# WikiMasters — À trier

Automatisation Chromium exécutée toutes les 10 minutes par GitHub Actions, même si le PC est éteint.

Les identifiants ne sont jamais dans le dépôt : créer les secrets GitHub `WIKIMASTERS_EMAIL` et `WIKIMASTERS_PASSWORD`, puis lancer le workflow **WikiMasters — ouvrir et étiqueter** une première fois.

L’extension Brave locale reste disponible dans ce même dossier, mais le worker cloud ne l’utilise pas.
