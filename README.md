# WikiMasters — À trier

[![Validation du script](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/run.yml/badge.svg)](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/run.yml)
[![Ouverture et tri](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/live.yml/badge.svg)](https://github.com/TheLightningD/wikimasters-a-trier/actions/workflows/live.yml)

GitHub Actions exécute la suite de tests sur ses runners hébergés à chaque modification, à la demande et une fois par jour. Le résumé indique clairement si l’installation et les tests ont réussi, ou quelle étape a échoué.

L’ouverture réelle ne peut plus fonctionner depuis une adresse IP de runner GitHub hébergé : Cloudflare y exige systématiquement une validation humaine. Le workflow **WikiMasters — ouvrir et trier** utilise donc un runner Windows auto-hébergé, lancé dans la session utilisateur, qui réutilise les identifiants DPAPI et le profil Chrome local. GitHub conserve la planification deux fois par heure ; le PC doit être allumé, connecté et le runner doit rester ouvert.

Les identifiants ne sont jamais enregistrés dans le dépôt ni dans les secrets GitHub. Ils restent chiffrés par Windows dans `%LOCALAPPDATA%\WikiMasters-A-Trier\credentials.xml`.

## Activer l’ouverture planifiée par GitHub

1. Lancer une fois `ouvrir-et-trier.cmd` pour enregistrer les identifiants et valider Cloudflare dans Chrome.
2. Dans GitHub, ouvrir **Settings → Actions → Runners → New self-hosted runner**, choisir **Windows / x64** et copier uniquement le jeton temporaire.
3. Double-cliquer sur `installer-runner-github.cmd`, puis coller ce jeton lorsqu’il est demandé.
4. Double-cliquer sur `demarrer-runner-github.cmd` et laisser sa fenêtre ouverte.

Le runner doit être lancé interactivement, **pas comme service Windows**, afin que Chrome reste visible si Cloudflare redemande une validation. Un hook local refuse tout job qui ne provient pas de `.github/workflows/live.yml` sur `main` avec un déclenchement planifié ou manuel ; les workflows de pull request ne peuvent donc pas utiliser ce PC. Les tests de pull request restent sur les runners GitHub isolés.

## Vérifier la version GitHub

Ouvrir l’onglet **Actions**, choisir **WikiMasters — validation du script** pour contrôler le code ou **WikiMasters — ouvrir et trier** pour lancer immédiatement le travail sur le runner Windows. Un run affiché comme **Queued** signifie généralement que `demarrer-runner-github.cmd` n’est pas ouvert.

## Lancer l’ouverture et le tri localement

Sur Windows, double-cliquer sur `ouvrir-et-trier.cmd`. Le lanceur affiche les cinq étapes en cours (préparation, connexion, boosters, étiquetage, nettoyage), puis un résumé chiffré et la durée. Il ouvre tous les boosters disponibles, ajoute « à trier » aux cartes sans étiquette et retire uniquement « à trier » des cartes qui possèdent une autre étiquette.

Les identifiants sont demandés au premier lancement, chiffrés par Windows pour l’utilisateur courant dans `%LOCALAPPDATA%\WikiMasters-A-Trier\credentials.xml`, puis réutilisés par les deux lanceurs. Le lanceur utilise Chrome ou Edge et installe les dépendances npm si nécessaire.

Pour les remplacer, exécuter `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\wishlist-local.ps1 -Audit -ResetCredentials` depuis le dossier du projet.

## Synchroniser les souhaits d’échange localement

Cette partie n’est pas exécutée par GitHub Actions. Sur Windows, double-cliquer sur `synchroniser-echanges.cmd` ; il réutilise les mêmes identifiants chiffrés que le lanceur d’ouverture des packs.

Le choix par défaut applique les étiquettes gérées `échange · <Pseudo>` aux cartes portant `#Osef`. Répondre `n` à la première question lance seulement un audit, sans modifier WikiMasters.

Le classement compare les critères du Google Sheets uniquement au titre et à la description affichés sur la carte WikiMasters, sans requête Wikipédia. Un petit lexique local interprète aussi des intentions larges ou familières (`cul` → pornographie, `sport` → football, basket, cyclisme, etc.) tout en conservant la raison d’origine dans le rapport. Le lanceur compte d’abord toutes les cartes `#Osef`, puis affiche une progression compacte par tranches de 5 % afin de garder le terminal lisible. L’inventaire et l’application n’ont pas de délai global ; un retrait lent est attendu puis retenté jusqu’à trois fois. Les attributions détaillées sont écrites dans `wishlist-report.json`, ignoré par Git ; ce lanceur ne lance ni les boosters ni les passes « à trier ».
