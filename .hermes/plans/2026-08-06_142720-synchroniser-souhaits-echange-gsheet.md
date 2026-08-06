# Synchronisation des souhaits d’échange depuis Google Sheets — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Étiqueter automatiquement les cartes portant l’étiquette exacte `osef` avec les pseudos des personnes susceptibles de les rechercher, à partir du Google Sheet partagé et régulièrement resynchronisé.

**Architecture:** Le Google Sheet public reste la source de vérité. Le worker Node récupère sa représentation Google Visualization JSON sans nouvelle dépendance, transforme les colonnes de pseudos en règles, inventorie uniquement les cartes `osef`, enrichit leur texte via l’API Wikipédia française, puis calcule un état désiré. Le navigateur ne fait que lire l’interface WikiMasters et synchroniser des étiquettes gérées sous le préfixe `échange · `, avec un mode audit local obligatoire avant toute mutation planifiée.

**Tech Stack:** Node.js 20 (`fetch`, `node:assert`, `crypto`), Playwright Core 1.62.1, API Google Visualization, API MediaWiki française, GitHub Actions, interface WikiMasters existante.

---

## 1. Décisions et critères d’acceptation

### Décisions par défaut

- Le libellé source est l’étiquette exacte `osef`.
- Les étiquettes créées sont nommées `échange · <Pseudo>` plutôt que seulement `<Pseudo>` : ce namespace permet à l’automatisation de retirer ses propres associations obsolètes sans toucher aux étiquettes manuelles.
- `osef` n’est jamais retirée par ce nouveau traitement.
- Une carte peut recevoir plusieurs étiquettes `échange · ...`.
- Le Google Sheet est relu à chaque synchronisation ; aucun cache persistant n’est nécessaire.
- La synchronisation planifiée est prévue toutes les 6 heures, pas à chaque vérification de booster.
- La première livraison reste en audit manuel ; la mutation planifiée n’est activée qu’après validation du rapport local.
- V1 utilise le titre, le résumé, les catégories Wikipédia et les textes/alternatives d’image disponibles. Elle n’analyse pas les pixels avec un modèle de vision.
- Une erreur de lecture ou de parsing du Google Sheet interdit toute suppression d’étiquette : échec fermé, sans modification partielle.

### Contrat minimal du Google Sheet actuel

- URL source : `https://docs.google.com/spreadsheets/d/1oyA_XJbYv1Tj0NGn7XBPGV6uGj7FMyiEknvds83iRic/edit?gid=0#gid=0`.
- URL machine : `https://docs.google.com/spreadsheets/d/1oyA_XJbYv1Tj0NGn7XBPGV6uGj7FMyiEknvds83iRic/gviz/tq?tqx=out:json&gid=0`.
- La ligne contenant `Pseudo` détermine dynamiquement la ligne des pseudos ; aucune coordonnée de cellule n’est codée en dur.
- La colonne de catégorie contient actuellement `Nature vivante`, `Nature morte`, `Sciences`, `Géographie`, `Constructions`, `Sports / Culture`, `Humains`.
- Chaque cellule d’un pseudo conserve sa catégorie, son texte brut et ses retours à la ligne.
- Une cellule vide ou exactement `/` ne produit aucune règle.
- Les retours à la ligne sont des alternatives.
- Les virgules et `/` à l’intérieur d’une ligne sont des alternatives ; `pas de ...` produit une exclusion.
- Les cellules longues sans séparateur explicite sont signalées comme ambiguës au lieu d’être silencieusement surinterprétées. Exemple actuel : `Jeux vidéos Drapeaux Automobile`.

### Critères d’acceptation

1. Le parseur retrouve les 23 pseudos actuellement présents sans dépendre de leur numéro de colonne.
2. Seules les cartes portant exactement `osef` sont candidates.
3. Une carte correspondant à plusieurs personnes reçoit toutes leurs étiquettes gérées.
4. Une association obsolète est retirée uniquement si son étiquette commence par `échange · `.
5. Les étiquettes `osef`, `à trier` et toutes les étiquettes manuelles restent intactes.
6. Un rerun inchangé produit zéro ajout et zéro retrait.
7. Une modification du Sheet est prise en compte au prochain run de synchronisation.
8. Une panne Google/Wikipédia/WikiMasters ne déclenche jamais une suppression massive.
9. Les journaux GitHub n’exposent ni identifiants ni inventaire nominatif complet ; seulement des compteurs.
10. Le tri actuel des boosters, l’ajout de `à trier` et son nettoyage continuent de passer avec `npm test`.

---

### Task 1: Capturer le contrat DOM WikiMasters manquant

**Objective:** Établir, sans supposition, les contrôles réels permettant de lire une carte `osef`, créer une étiquette de pseudo, l’ajouter et la retirer.

**Files:**
- Inspect: `content.js:63-235`
- Modify later: `collection.html`
- No production change in this task.

**Step 1: lancer une inspection non destructive**

Lancer localement le worker en mode collection, avec les identifiants déjà disponibles dans l’environnement, et capturer le DOM d’une carte portant `osef` sans cliquer sur une action de mutation.

**Step 2: relever les éléments suivants**

- sélecteur stable de la carte ;
- titre de carte et éventuel lien vers l’article Wikipédia ;
- badges d’étiquettes ;
- contrôle d’ouverture du sélecteur d’étiquettes ;
- option de création lorsqu’une étiquette n’existe pas ;
- contrôle exact de retrait d’une étiquette ;
- confirmation serveur ou DOM après ajout/retrait.

**Step 3: mettre à jour le banc synthétique**

Modifier `collection.html` afin de reproduire ces contrôles réels avec :

- une carte `osef` ;
- une carte sans `osef` ;
- une étiquette gérée existante ;
- une étiquette gérée absente nécessitant une création ;
- une confirmation d’ajout et une confirmation de retrait.

**Step 4: vérifier le banc existant**

Run: `npm test`

Expected: PASS avant l’ajout du nouveau comportement ; le fixture ne doit pas casser les flux actuels.

**Step 5: commit**

```bash
git add collection.html
git commit -m "test: model WikiMasters exchange labels"
```

---

### Task 2: Ajouter le lecteur dynamique du Google Sheet

**Objective:** Télécharger et transformer la feuille courante en une liste déterministe de pseudos et cellules de critères, sans dépendance CSV.

**Files:**
- Create: `wishlist.js`
- Create: `wishlist.test.js`
- Modify: `package.json:5-8`

**Step 1: écrire le test rouge**

Dans `wishlist.test.js`, utiliser `node:assert/strict` et un petit payload Google Visualization contenant deux pseudos, plusieurs catégories, une cellule `/` et des retours à la ligne.

```js
const assert = require('node:assert/strict');
const { parseGviz, parseWishlists } = require('./wishlist');

const body = 'google.visualization.Query.setResponse(' + JSON.stringify({
  status: 'ok',
  table: {
    rows: [
      { c: [{ v: null }, { v: 'Pseudo' }, { v: null }, { v: 'Alyeena' }, { v: 'Canard' }] },
      { c: [{ v: null }, { v: 'Trucs recherchés' }, { v: 'Nature vivante' }, { v: null }, { v: 'Canard' }] },
      { c: [{ v: null }, { v: null }, { v: 'Géographie' }, { v: 'Lyon\nAuvergne' }, { v: '/' }] }
    ]
  }
}) + ');';

const parsed = parseWishlists(parseGviz(body));
assert.deepEqual(parsed.map(item => item.pseudo), ['Alyeena', 'Canard']);
assert.deepEqual(parsed[0].cells, [{ category: 'Géographie', raw: 'Lyon\nAuvergne' }]);
assert.deepEqual(parsed[1].cells, [{ category: 'Nature vivante', raw: 'Canard' }]);
console.log('wishlist parser: ok');
```

**Step 2: vérifier l’échec**

Run: `node wishlist.test.js`

Expected: FAIL — `Cannot find module './wishlist'`.

**Step 3: implémenter le minimum**

Dans `wishlist.js` :

```js
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oyA_XJbYv1Tj0NGn7XBPGV6uGj7FMyiEknvds83iRic/gviz/tq?tqx=out:json&gid=0';

function parseGviz(body) {
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Réponse Google Sheets invalide');
  const payload = JSON.parse(body.slice(start, end + 1));
  if (payload.status !== 'ok' || !payload.table?.rows) throw new Error('Google Sheets indisponible');
  return payload.table;
}

function value(row, index) {
  return String(row?.c?.[index]?.v ?? '').trim();
}

function parseWishlists(table) {
  const rows = table.rows;
  const headerIndex = rows.findIndex(row => row.c?.some(cell => String(cell?.v ?? '').trim() === 'Pseudo'));
  if (headerIndex < 0) throw new Error('Ligne « Pseudo » introuvable');
  const header = rows[headerIndex];
  const pseudoStart = header.c.findIndex(cell => String(cell?.v ?? '').trim() === 'Pseudo') + 2;
  return header.c.slice(pseudoStart).map((cell, offset) => {
    const column = pseudoStart + offset;
    const pseudo = String(cell?.v ?? '').trim();
    if (!pseudo) return null;
    const cells = rows.slice(headerIndex + 1).map(row => ({
      category: value(row, pseudoStart - 1),
      raw: value(row, column)
    })).filter(item => item.raw && item.raw !== '/');
    return { pseudo, label: `échange · ${pseudo}`, cells };
  }).filter(Boolean);
}

async function fetchWishlists(fetchImpl = fetch) {
  const response = await fetchImpl(SHEET_URL);
  if (!response.ok) throw new Error(`Google Sheets inaccessible (${response.status})`);
  return parseWishlists(parseGviz(await response.text()));
}

module.exports = { SHEET_URL, parseGviz, parseWishlists, fetchWishlists };
```

Pendant l’implémentation, ajuster la détection de la colonne catégorie au DOM réel de la feuille plutôt que conserver un index erroné ; le test doit refléter exactement la structure actuelle.

**Step 4: passer le test et l’intégrer à npm**

Modifier `package.json` :

```json
"test": "node wishlist.test.js && node test.js"
```

Run: `npm test`

Expected: `wishlist parser: ok`, puis le scénario Playwright existant réussit.

**Step 5: commit**

```bash
git add wishlist.js wishlist.test.js package.json
git commit -m "feat: read exchange wishes from Google Sheets"
```

---

### Task 3: Transformer les cellules en règles explicables

**Objective:** Convertir le texte humain en inclusions/exclusions déterministes et signaler les cellules ambiguës.

**Files:**
- Modify: `wishlist.js`
- Modify: `wishlist.test.js`

**Step 1: écrire les assertions rouges**

```js
const { parseRuleCell } = require('./wishlist');

assert.deepEqual(parseRuleCell('Phoque / Otarie\nChèvre', 'Nature vivante'), {
  category: 'Nature vivante',
  include: ['phoque', 'otarie', 'chevre'],
  exclude: [],
  ambiguous: false
});
assert.deepEqual(parseRuleCell('Singes, oiseaux, insectes, pas de mammifères', 'Nature vivante').exclude, ['mammifere']);
assert.equal(parseRuleCell('Jeux vidéos Drapeaux Automobile', 'Sports / Culture').ambiguous, true);
```

**Step 2: vérifier l’échec**

Run: `node wishlist.test.js`

Expected: FAIL — `parseRuleCell is not a function`.

**Step 3: implémenter les règles minimales**

- normaliser NFD, accents, casse et ponctuation ;
- découper les alternatives sur retour à la ligne, virgule et `/` ;
- interpréter `pas de`, `sans` et `sauf` comme exclusions ;
- retirer seulement les mots-outils français (`de`, `du`, `la`, `le`, `les`, `des`, `d`, `une`, `un`) lors du matching ;
- conserver le texte brut dans le rapport ;
- signaler comme ambiguë toute séquence de plus de quatre mots utiles sans séparateur ;
- ne jamais transformer une règle ambiguë en suppression automatique.

Ajouter un commentaire explicite dans le matcher :

```js
// ponytail: matching textuel explicable ; ajouter vision/LLM seulement si l’audit montre des faux négatifs importants.
```

**Step 4: exécuter les tests**

Run: `node wishlist.test.js && npm test`

Expected: PASS.

**Step 5: commit**

```bash
git add wishlist.js wishlist.test.js
git commit -m "feat: normalize exchange matching rules"
```

---

### Task 4: Inventorier uniquement les cartes `osef`

**Objective:** Parcourir toute la collection et retourner un inventaire minimal, stable et non destructif des cartes candidates.

**Files:**
- Modify: `content.js:28-237`
- Modify: `worker.js:8-31`
- Modify: `collection.html`
- Modify: `test.js`

**Step 1: ajouter un scénario rouge au fixture**

Dans `collection.html`, ajouter :

- une carte avec `osef` et un lien Wikipédia ;
- une carte `osef` avec une autre étiquette ;
- une carte sans `osef` ;
- deux pages de collection.

Dans `test.js`, exiger un résultat de la forme :

```json
{
  "inventory": [
    {
      "id": "article:https://fr.wikipedia.org/wiki/Canard",
      "title": "Canard",
      "articleUrl": "https://fr.wikipedia.org/wiki/Canard",
      "labels": ["osef"],
      "text": "Canard ...",
      "imageAlt": "Canard colvert"
    }
  ]
}
```

Vérifier que la carte sans `osef` est absente.

**Step 2: vérifier l’échec**

Run: `npm test`

Expected: FAIL — aucun mode `inventory` n’existe.

**Step 3: ajouter le mode navigateur**

Dans `content.js` :

- ajouter `const INVENTORY = MODE === 'inventory';` ;
- réutiliser `collectionCards`, `cardLabels`, `nextCollectionPage`, `openCardDetails` et `closeCardDetails` ;
- ouvrir chaque carte portant le badge exact `osef` ;
- extraire l’URL Wikipédia comme identité primaire ;
- utiliser un identifiant de secours stable dérivé du titre seulement si aucun lien n’existe ;
- fermer la fiche avant de continuer ;
- ne cliquer sur aucun contrôle d’étiquette ;
- retourner l’inventaire dans le détail de l’événement `wm-tri-finished` ou dans un champ dédié de `window.__WM_TRI__`.

Dans `worker.js`, étendre `automate(page, mode, input)` pour injecter l’entrée et lire `inventory` sans changer les autres modes.

**Step 4: exécuter les tests**

Run: `npm test`

Expected: l’inventaire contient seulement les cartes `osef`, sur toutes les pages.

**Step 5: commit**

```bash
git add content.js worker.js collection.html test.js
git commit -m "feat: inventory osef collection cards"
```

---

### Task 5: Enrichir les cartes via l’API Wikipédia et calculer les correspondances

**Objective:** Calculer un état désiré explicable sans modifier WikiMasters.

**Files:**
- Modify: `wishlist.js`
- Modify: `wishlist.test.js`
- Modify: `worker.js`

**Step 1: écrire le test rouge du matcher**

```js
const { desiredLabels } = require('./wishlist');

const card = {
  id: 'article:canard',
  title: 'Canard colvert',
  labels: ['osef'],
  metadata: 'Le Canard colvert est une espèce d oiseaux. Catégories: Oiseau, Anatidae.'
};
const wishes = [
  { pseudo: 'Canard', label: 'échange · Canard', rules: [{ include: ['canard'], exclude: [], ambiguous: false }] },
  { pseudo: 'zine\'', label: "échange · zine'", rules: [{ include: ['oiseau'], exclude: ['mammifere'], ambiguous: false }] }
];
assert.deepEqual(desiredLabels(card, wishes), ['échange · Canard', "échange · zine'"]);
```

Ajouter aussi : exclusion `mammifère`, règle ambiguë ignorée, carte sans `osef`, pluriels simples (`oiseau/oiseaux`, `félin/félins`).

**Step 2: vérifier l’échec**

Run: `node wishlist.test.js`

Expected: FAIL — matcher absent.

**Step 3: implémenter l’enrichissement par lots**

Utiliser l’API MediaWiki en paquets de 50 titres :

```text
https://fr.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=extracts|categories&exintro=1&explaintext=1&cllimit=max&titles=<titres séparés par |>
```

- faire au maximum une requête par lot de 50 titres ;
- conserver en mémoire uniquement pendant le run ;
- concaténer titre, extrait, catégories et `imageAlt` avant matching ;
- faire un matching de tokens normalisés avec frontière de mot et pluriel français simple ;
- exiger au moins une inclusion ;
- refuser le match si une exclusion correspond ;
- ignorer les règles ambiguës mais les compter dans le rapport.

**Step 4: produire un plan de synchronisation**

```js
{
  additions: [{ cardId, labels: ['échange · Canard'] }],
  removals: [{ cardId, labels: ['échange · AncienPseudo'] }],
  unchanged: 42,
  ambiguousRules: [...],
  countsByPseudo: { Canard: 3 }
}
```

Les retraits ne peuvent contenir que des labels commençant par `échange · `.

**Step 5: exécuter les tests**

Run: `node wishlist.test.js && npm test`

Expected: PASS.

**Step 6: commit**

```bash
git add wishlist.js wishlist.test.js worker.js
git commit -m "feat: match osef cards to exchange wishes"
```

---

### Task 6: Générer un audit local sans mutation

**Objective:** Permettre la validation humaine des correspondances avant de toucher au compte.

**Files:**
- Modify: `worker.js`
- Modify: `.gitignore`
- Modify: `README.md`
- Test: `test.js`

**Step 1: écrire le test rouge**

Lancer le worker synthétique avec :

```text
WISHLIST_SYNC=true
WISHLIST_APPLY=false
```

Exiger :

- `wishlist-report.json` créé ;
- aucune étiquette modifiée dans `collection.html` ;
- compteurs `cardsScanned`, `additions`, `removals`, `ambiguousRules` présents.

**Step 2: vérifier l’échec**

Run: `npm test`

Expected: FAIL — rapport absent.

**Step 3: implémenter le mode audit**

- écrire `wishlist-report.json` seulement lorsque `WISHLIST_SYNC=true` ;
- inclure les noms de cartes uniquement dans ce fichier local ;
- dans les logs GitHub, écrire uniquement les compteurs ;
- ajouter `wishlist-report.json` à `.gitignore` ;
- ne pas téléverser ce rapport depuis le dépôt public ;
- calculer un SHA-256 du contenu de la feuille pour tracer la version sans la recopier.

**Step 4: documenter la commande locale**

```bash
WISHLIST_SYNC=true WISHLIST_APPLY=false npm start
```

Expected: aucun changement WikiMasters et un rapport local consultable.

**Step 5: exécuter les tests**

Run: `npm test && git diff --check`

Expected: PASS.

**Step 6: commit**

```bash
git add worker.js test.js .gitignore README.md
git commit -m "feat: audit exchange matches without changes"
```

---

### Task 7: Créer et synchroniser les étiquettes gérées

**Objective:** Appliquer l’état désiré avec confirmations, de manière idempotente et sans toucher aux autres étiquettes.

**Files:**
- Modify: `content.js`
- Modify: `worker.js`
- Modify: `collection.html`
- Modify: `test.js`

**Step 1: écrire le test rouge d’ajout**

Cas synthétique : carte `osef`, état désiré `['échange · Canard']`, étiquette absente du compte.

Assertions :

- l’étiquette `échange · Canard` est créée une seule fois ;
- elle est appliquée à la carte ;
- `osef` reste présente ;
- l’ajout n’est compté qu’après confirmation DOM/serveur.

**Step 2: vérifier l’échec**

Run: `npm test`

Expected: FAIL — aucun mode `wishlist-apply`.

**Step 3: généraliser les helpers existants**

Dans `content.js`, remplacer les helpers codés uniquement pour `à trier` par des versions paramétrées tout en conservant les wrappers existants :

```js
const optionNamed = name => controls().find(el => el.matches('button,[role="button"]') && label(el) === norm(name));
const removalNamed = name => controls().find(el => label(el).includes(`retirer l etiquette ${norm(name)}`));
const targetOption = () => optionNamed('à trier');
const targetRemoval = () => removalNamed('à trier');
```

Utiliser le contrôle de création relevé dans Task 1 ; ne jamais simuler une option existante en remplissant arbitrairement le champ si l’UI exige un clic explicite.

**Step 4: implémenter les ajouts groupés**

- grouper les ajouts par label puis par page ;
- réutiliser le mode de sélection en masse existant ;
- créer chaque label au plus une fois par run ;
- confirmer chaque lot avant comptage ;
- limiter les pauses au minimum nécessaire pour éviter de surcharger WikiMasters.

**Step 5: écrire le test rouge de retrait**

Cas synthétique : carte `osef` portant `échange · AncienPseudo`, état désiré vide.

Assertions :

- seule `échange · AncienPseudo` disparaît ;
- `osef`, `à trier` et une étiquette manuelle restent présentes ;
- un retrait non confirmé fait échouer le run.

**Step 6: implémenter les retraits**

Réutiliser la logique confirmée de `processCleanup`, mais filtrer strictement sur le préfixe `échange · ` et sur le plan de synchronisation injecté.

**Step 7: vérifier l’idempotence**

Exécuter deux fois le même scénario synthétique.

Expected second run: `0 ajout`, `0 retrait`.

Run: `npm test`

Expected: PASS.

**Step 8: commit**

```bash
git add content.js worker.js collection.html test.js
git commit -m "feat: sync managed exchange labels"
```

---

### Task 8: Préserver l’ordre des phases et les erreurs

**Objective:** Exécuter la synchronisation après le tri courant, même si la phase booster a une erreur récupérable, puis restituer la bonne erreur finale.

**Files:**
- Modify: `worker.js:62-90`
- Modify: `test.js`

**Step 1: étendre le scénario rouge d’erreur de pulls**

Le fixture `?pull-error=1` doit prouver l’ordre suivant :

1. erreur pulls capturée ;
2. ajout `à trier` exécuté ;
3. nettoyage `à trier` exécuté ;
4. synchronisation des souhaits exécutée si `WISHLIST_SYNC=true` ;
5. erreur pulls originale restituée après les trois phases.

**Step 2: vérifier l’échec**

Run: `npm test`

Expected: FAIL si la wishlist est sautée après l’erreur pulls.

**Step 3: ajouter la phase optionnelle**

Après `cleanup` et avant `if (pullsError) throw pullsError` :

```js
if (process.env.WISHLIST_SYNC === 'true') {
  // fetch sheet -> inventory -> enrich -> plan -> audit/apply
}
```

Ordre des erreurs :

- erreur de synchronisation : échec explicite ;
- sinon erreur pulls préexistante : la restituer ;
- aucune erreur : succès.

**Step 4: exécuter tous les tests**

Run: `npm test && git diff --check`

Expected: PASS.

**Step 5: commit**

```bash
git add worker.js test.js
git commit -m "feat: run exchange sync after collection sorting"
```

---

### Task 9: Ajouter le déclenchement manuel et le résumé GitHub

**Objective:** Tester la synchronisation à la demande sans l’activer immédiatement en production.

**Files:**
- Modify: `.github/workflows/run.yml:8-48`
- Modify: `README.md`

**Step 1: ajouter les inputs manuels**

```yaml
wishlist_sync:
  description: "Relire les souhaits d’échange du Google Sheet"
  required: false
  default: false
  type: boolean
wishlist_apply:
  description: "Appliquer les étiquettes (sinon audit seulement)"
  required: false
  default: false
  type: boolean
```

**Step 2: propager les variables**

```yaml
WISHLIST_SYNC: ${{ github.event_name == 'workflow_dispatch' && inputs.wishlist_sync }}
WISHLIST_APPLY: ${{ github.event_name == 'workflow_dispatch' && inputs.wishlist_apply }}
```

Ne pas encore activer la synchronisation planifiée.

**Step 3: ajouter un résumé sans données privées**

Résumé autorisé :

- hash de feuille ;
- nombre de pseudos/règles ;
- nombre de cartes `osef` parcourues ;
- nombre d’ajouts/retraits ;
- nombre de règles ambiguës ;
- statut audit/application.

Ne pas écrire la liste complète des cartes dans les logs ou artefacts du dépôt public.

**Step 4: valider le YAML et les tests**

Run: `npm test && git diff --check`

Expected: PASS.

**Step 5: commit**

```bash
git add .github/workflows/run.yml README.md
git commit -m "feat: add manual exchange wishlist sync"
```

---

### Task 10: Valider l’audit puis activer la synchronisation toutes les 6 heures

**Objective:** Passer prudemment du rapport à l’application planifiée.

**Files:**
- Modify after approval: `.github/workflows/run.yml`
- No code change before human approval.

**Step 1: lancer un audit local**

```bash
WISHLIST_SYNC=true WISHLIST_APPLY=false npm start
```

Vérifier dans `wishlist-report.json` :

- échantillon d’au moins 20 correspondances ;
- faux positifs ;
- règles ambiguës ;
- critères visuels non couverts ;
- nombre de correspondances par pseudo.

**Step 2: corriger uniquement les règles nécessaires**

Préférer la clarification du Google Sheet — une règle par ligne, exclusions explicites — à une table de synonymes codée en dur.

**Step 3: lancer une application manuelle limitée**

Utiliser `workflow_dispatch` avec `wishlist_sync=true`, `wishlist_apply=true` et vérifier :

- création des étiquettes `échange · ...` ;
- conservation de `osef` ;
- ajouts/retraits confirmés ;
- second run idempotent.

**Step 4: activer la cadence six heures**

Une fois validé, modifier seulement l’expression :

```yaml
WISHLIST_SYNC: ${{ (github.event_name == 'workflow_dispatch' && inputs.wishlist_sync) || github.event.schedule == '7 */6 * * *' }}
WISHLIST_APPLY: ${{ github.event.schedule == '7 */6 * * *' || (github.event_name == 'workflow_dispatch' && inputs.wishlist_apply) }}
```

**Step 5: vérifier et commit**

Run: `npm test && git diff --check`

```bash
git add .github/workflows/run.yml
git commit -m "feat: sync exchange wishes every six hours"
```

**Step 6: vérifier deux runs réels**

- premier run : modifications attendues ;
- second run : zéro modification si le Sheet et la collection n’ont pas changé ;
- modifier ensuite un critère bénin dans le Sheet et confirmer sa prise en compte au run suivant.

---

## Files likely to change

| Fichier | Changement prévu |
|---|---|
| `wishlist.js` | Lecture Google Sheet, règles, enrichissement Wikipédia, matching et plan de synchronisation |
| `wishlist.test.js` | Auto-test Node sans framework du parseur et du matcher |
| `content.js` | Modes `inventory` et `wishlist-apply`, helpers d’étiquettes génériques |
| `worker.js` | Orchestration audit/application après les phases existantes |
| `collection.html` | Banc DOM des cartes `osef`, étiquettes gérées, création et retrait |
| `test.js` | Scénarios Playwright d’inventaire, ajout, retrait, erreur et idempotence |
| `package.json` | Ajout du self-check `wishlist.test.js` à `npm test` |
| `.github/workflows/run.yml` | Inputs manuels puis cadence 6 h après validation |
| `.gitignore` | Exclusion de `wishlist-report.json` |
| `README.md` | Procédure d’audit, application et interprétation des compteurs |

Aucune dépendance npm supplémentaire n’est prévue.

---

## Risques et garde-fous

- **Langage humain ambigu :** audit obligatoire ; les règles ambiguës ne provoquent aucune suppression.
- **Critères visuels :** V1 utilise seulement les textes/captions disponibles. Ajouter une vision automatique uniquement si l’audit démontre que ce plafond est insuffisant.
- **Faux positifs sémantiques :** matcher explicable et conservateur ; préférer des critères plus précis dans le Sheet.
- **Évolution de la mise en page du Sheet :** recherche dynamique de `Pseudo` et validation stricte ; aucun changement WikiMasters si parsing incomplet.
- **Évolution du DOM WikiMasters :** fixture calé sur le DOM réel, confirmation après chaque lot, diagnostics existants conservés.
- **Suppression accidentelle :** seules les étiquettes préfixées `échange · ` sont gérées ; `osef` et les labels manuels sont intouchables.
- **Charge réseau :** appels Wikipédia par lots de 50 et synchronisation six-heures seulement.
- **Dépôt GitHub public :** ne jamais téléverser l’inventaire détaillé ; audit nominatif uniquement local.

---

## Questions à confirmer pendant l’audit

1. Le nom `échange · <Pseudo>` convient-il, ou faut-il afficher uniquement le pseudo ?
2. Une association devenue obsolète doit-elle être retirée automatiquement ? Le plan suppose oui, uniquement dans le namespace géré.
3. Les critères parlant explicitement d’une image doivent-ils attendre une V2 avec analyse visuelle, ou le titre/caption Wikipédia suffit-il ?
4. Le groupe peut-il adopter « une règle par ligne » dans le Sheet pour supprimer les ambiguïtés futures ?

---

## Verification finale

```bash
node --check content.js
node --check worker.js
node --check wishlist.js
node wishlist.test.js
npm test
git diff --check
git status --short
```

Expected:

- tous les contrôles passent ;
- aucun secret ni rapport détaillé suivi par Git ;
- audit local cohérent ;
- application manuelle confirmée ;
- second run idempotent ;
- synchronisation planifiée activée seulement après validation humaine.
