# WikiMasters — À trier

[![État de l'automatisation](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/run.yml/badge.svg)](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/run.yml)

Automatisation Chromium exécutée toutes les 10 minutes par GitHub Actions, même si le PC est éteint.

La collection est aussi contrôlée toutes les 6 heures : seules les cartes sans aucune étiquette reçoivent « à trier ».

Les identifiants ne sont jamais dans le dépôt : créer les secrets GitHub `WIKIMASTERS_EMAIL` et `WIKIMASTERS_PASSWORD`, puis lancer le workflow **WikiMasters — ouvrir et étiqueter** une première fois.

L’extension Brave locale reste disponible dans ce même dossier, mais le worker cloud ne l’utilise pas.

## Vérifier maintenant

Ouvrir l’onglet **Actions**, choisir **WikiMasters — ouvrir et étiqueter**, puis **Run workflow**. Le badge ci-dessus devient vert si l’ouverture des packs et le contrôle de la collection réussissent.

## Lancer l’ouverture et le tri localement

Sur Windows, double-cliquer sur `ouvrir-et-trier.cmd`. Le lanceur ouvre tous les boosters disponibles, ajoute « à trier » aux cartes sans étiquette et retire uniquement « à trier » des cartes qui possèdent une autre étiquette.

Les identifiants sont demandés au premier lancement, chiffrés par Windows pour l’utilisateur courant dans `%LOCALAPPDATA%\WikiMasters-A-Trier\credentials.xml`, puis réutilisés par les deux lanceurs. Le lanceur utilise Chrome ou Edge et installe les dépendances npm si nécessaire.

Pour les remplacer, exécuter `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\wishlist-local.ps1 -Audit -ResetCredentials` depuis le dossier du projet.

## Synchroniser les souhaits d’échange localement

Cette partie n’est pas exécutée par GitHub Actions. Sur Windows, double-cliquer sur `synchroniser-echanges.cmd` ; il réutilise les mêmes identifiants chiffrés que le lanceur d’ouverture des packs.

Le choix par défaut applique les étiquettes gérées `échange · <Pseudo>` aux cartes portant `#Osef`. Répondre `n` à la première question lance seulement un audit, sans modifier WikiMasters.

Le classement compare les critères du Google Sheets uniquement au titre WikiMasters et à la description Wikipédia. Le lanceur compte d’abord toutes les cartes `#Osef`, puis affiche des barres `traitées/total`, les attributions et leurs raisons au fil de l’eau. L’inventaire et l’application n’ont pas de délai global ; un retrait lent est attendu puis retenté jusqu’à trois fois. Le détail est aussi écrit dans `wishlist-report.json`, ignoré par Git ; ce lanceur ne lance ni les boosters ni les passes « à trier ».
