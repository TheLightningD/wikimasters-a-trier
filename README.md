# WikiMasters — À trier

[![Validation du script](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/run.yml/badge.svg)](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/run.yml)

GitHub Actions installe les dépendances et exécute toute la suite de tests à chaque modification, à la demande et une fois par jour. Le résumé du workflow indique clairement si l’installation et les tests ont réussi, ou quelle étape a échoué.

L’ouverture réelle des boosters n’est pas exécutée sur un runner GitHub hébergé. WikiMasters demande de confirmer manuellement la fenêtre « Vérification rapide »; cette action est donc effectuée avec le raccourci Windows, dans un navigateur visible.

Aucun identifiant WikiMasters n’est envoyé à GitHub Actions.

## Vérifier la version GitHub

Ouvrir l’onglet **Actions**, choisir **WikiMasters — validation du script**, puis **Run workflow**. Le badge ci-dessus devient vert si l’installation propre et tous les scénarios automatisés réussissent. En cas d’échec, le résumé du run affiche l’étape concernée et l’annotation renvoie vers les logs utiles.

## Lancer l’ouverture et le tri localement

Sur Windows, double-cliquer sur `ouvrir-et-trier.cmd`. Le lanceur affiche les cinq étapes en cours (préparation, connexion, boosters, étiquetage, nettoyage), puis un résumé chiffré et la durée. Il ouvre tous les boosters disponibles, ajoute « à trier » aux cartes sans étiquette et retire uniquement « à trier » des cartes qui possèdent une autre étiquette.

Les identifiants sont demandés au premier lancement, chiffrés par Windows pour l’utilisateur courant dans `%LOCALAPPDATA%\WikiMasters-A-Trier\credentials.xml`, puis réutilisés par les deux lanceurs. Le lanceur utilise Chrome ou Edge et installe les dépendances npm si nécessaire.

Pour les remplacer, exécuter `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\wishlist-local.ps1 -Audit -ResetCredentials` depuis le dossier du projet.

## Synchroniser les souhaits d’échange localement

Cette partie n’est pas exécutée par GitHub Actions. Sur Windows, double-cliquer sur `synchroniser-echanges.cmd` ; il réutilise les mêmes identifiants chiffrés que le lanceur d’ouverture des packs.

Le choix par défaut applique les étiquettes gérées `échange · <Pseudo>` aux cartes portant `#Osef`. Répondre `n` à la première question lance seulement un audit, sans modifier WikiMasters.

Le classement compare les critères du Google Sheets uniquement au titre et à la description affichés sur la carte WikiMasters, sans requête Wikipédia. Un petit lexique local interprète aussi des intentions larges ou familières (`cul` → pornographie, `sport` → football, basket, cyclisme, etc.) tout en conservant la raison d’origine dans le rapport. Le lanceur compte d’abord toutes les cartes `#Osef`, puis affiche une progression compacte par tranches de 5 % afin de garder le terminal lisible. L’inventaire et l’application n’ont pas de délai global ; un retrait lent est attendu puis retenté jusqu’à trois fois. Les attributions détaillées sont écrites dans `wishlist-report.json`, ignoré par Git ; ce lanceur ne lance ni les boosters ni les passes « à trier ».
