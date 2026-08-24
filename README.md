# WikiMasters — À trier

[![Validation du script](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/run.yml/badge.svg)](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/run.yml)
[![Ouverture et tri](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/live.yml/badge.svg)](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/live.yml)

GitHub Actions exécute la suite de tests sur ses runners hébergés à chaque modification, à la demande et une fois par jour. Le résumé indique clairement si l’installation et les tests ont réussi, ou quelle étape a échoué.

Le workflow **WikiMasters — ouvrir et trier** s’exécute entièrement sur un runner GitHub hébergé, même lorsque le PC est éteint. Il injecte une session WikiMasters déjà authentifiée et évite ainsi le formulaire Cloudflare, sans résoudre ni contourner le CAPTCHA.

La session renouvelée est filtrée aux seuls cookies d’authentification WikiMasters, chiffrée en AES-256-GCM puis conservée sur la branche technique `wikimasters-session`. La clé reste le secret GitHub `WIKIMASTERS_SESSION_B64` ; ni les cookies ni les identifiants ne sont enregistrés en clair dans le dépôt.

## Activer l’ouverture planifiée par GitHub

1. Lancer une fois `ouvrir-et-trier.cmd` pour se connecter et valider Cloudflare dans Chrome.
2. Fermer la fenêtre Chrome WikiMasters, puis double-cliquer sur `exporter-session-github.cmd`.
3. La session est copiée dans le presse-papiers et la page GitHub des secrets s’ouvre. Créer le secret **`WIKIMASTERS_SESSION_B64`** et coller la valeur sans la partager.
4. Dans **Actions → WikiMasters — ouvrir et trier**, lancer une première exécution manuelle en cochant **reset_session**. Les suivantes seront entièrement automatiques deux fois par heure.

Chaque run sauvegarde la session rafraîchie de manière chiffrée pour le suivant. Si WikiMasters révoque toute la session, refaire les étapes 1 à 3 puis lancer manuellement le workflow en cochant **reset_session** ; aucune intervention n’est normalement nécessaire entre les runs. Les anciens secrets `WIKIMASTERS_EMAIL` et `WIKIMASTERS_PASSWORD` ne sont plus utilisés.

## Vérifier la version GitHub

Ouvrir l’onglet **Actions**, choisir **WikiMasters — validation du script** pour contrôler le code ou **WikiMasters — ouvrir et trier** pour lancer immédiatement l’automatisation réelle sur GitHub.

## Lancer l’ouverture et le tri localement

Sur Windows, double-cliquer sur `ouvrir-et-trier.cmd`. Le lanceur affiche les cinq étapes en cours (préparation, connexion, boosters, étiquetage, nettoyage), puis un résumé chiffré et la durée. Il ouvre tous les boosters disponibles, ajoute « à trier » aux cartes sans étiquette et retire uniquement « à trier » des cartes qui possèdent une autre étiquette.

Les identifiants sont demandés au premier lancement, chiffrés par Windows pour l’utilisateur courant dans `%LOCALAPPDATA%\WikiMasters-A-Trier\credentials.xml`, puis réutilisés par les deux lanceurs. Le lanceur utilise Chrome ou Edge et installe les dépendances npm si nécessaire.

Pour les remplacer, exécuter `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\wishlist-local.ps1 -Audit -ResetCredentials` depuis le dossier du projet.

## Synchroniser les souhaits d’échange localement

Cette partie n’est pas exécutée par GitHub Actions. Sur Windows, double-cliquer sur `synchroniser-echanges.cmd` ; il réutilise les mêmes identifiants chiffrés que le lanceur d’ouverture des packs.

Le choix par défaut applique les étiquettes gérées `échange · <Pseudo>` aux cartes portant `#Osef`. Répondre `n` à la première question lance seulement un audit, sans modifier WikiMasters.

Le classement compare les critères du Google Sheets uniquement au titre et à la description affichés sur la carte WikiMasters, sans requête Wikipédia. Un petit lexique local interprète aussi des intentions larges ou familières (`cul` → pornographie, `sport` → football, basket, cyclisme, etc.) tout en conservant la raison d’origine dans le rapport. Le lanceur compte d’abord toutes les cartes `#Osef`, puis affiche une progression compacte par tranches de 5 % afin de garder le terminal lisible. L’inventaire et l’application n’ont pas de délai global ; un retrait lent est attendu puis retenté jusqu’à trois fois. Les attributions détaillées sont écrites dans `wishlist-report.json`, ignoré par Git ; ce lanceur ne lance ni les boosters ni les passes « à trier ».
