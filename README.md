# WikiMasters — À trier

[![État de l'automatisation](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/run.yml/badge.svg)](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/run.yml)

Automatisation Chromium exécutée toutes les 10 minutes par GitHub Actions, même si le PC est éteint.

La collection est aussi contrôlée toutes les 6 heures : seules les cartes sans aucune étiquette reçoivent « à trier ».

Les identifiants ne sont jamais dans le dépôt : créer les secrets GitHub `WIKIMASTERS_EMAIL` et `WIKIMASTERS_PASSWORD`, puis lancer le workflow **WikiMasters — ouvrir et étiqueter** une première fois.

L’extension Brave locale reste disponible dans ce même dossier, mais le worker cloud ne l’utilise pas.

## Vérifier maintenant

Ouvrir l’onglet **Actions**, choisir **WikiMasters — ouvrir et étiqueter**, puis **Run workflow**. Le badge ci-dessus devient vert si l’ouverture des packs et le contrôle de la collection réussissent.
