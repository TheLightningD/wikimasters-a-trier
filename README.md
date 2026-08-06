# WikiMasters — À trier

[![État de l'automatisation](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/run.yml/badge.svg)](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/run.yml)

Automatisation Chromium exécutée toutes les 10 minutes par GitHub Actions, même si le PC est éteint.

La collection est aussi contrôlée toutes les 6 heures : seules les cartes sans aucune étiquette reçoivent « à trier ».

Les identifiants ne sont jamais dans le dépôt : créer les secrets GitHub `WIKIMASTERS_EMAIL` et `WIKIMASTERS_PASSWORD`, puis lancer le workflow **WikiMasters — ouvrir et étiqueter** une première fois.

L’extension Brave locale reste disponible dans ce même dossier, mais le worker cloud ne l’utilise pas.

## Vérifier maintenant

Ouvrir l’onglet **Actions**, choisir **WikiMasters — ouvrir et étiqueter**, puis **Run workflow**. Le badge ci-dessus devient vert si l’ouverture des packs et le contrôle de la collection réussissent.

## Auditer les souhaits d’échange

Le mode audit lit le Google Sheet et les métadonnées Wikipédia sans modifier les étiquettes WikiMasters :

```bash
WISHLIST_SYNC=true WISHLIST_APPLY=false npm start
```

Les compteurs sont affichés dans les logs. Le détail local est écrit dans `wishlist-report.json`, ignoré par Git et jamais téléversé par le workflow public.

Le lancement manuel GitHub propose `wishlist_sync` pour cet audit et `wishlist_apply` pour créer ou synchroniser les étiquettes gérées `échange · <Pseudo>` sur les cartes portant `#Osef`. Le résumé Actions reste agrégé : aucun titre de carte n’y est publié.
