# WikiMasters-A-Trier : Plan d'améliorations continues

> **Pour Hermes :** Ce plan documente les améliorations identifiées après revue complète du codebase. À exécuter tâche par tâche via `subagent-driven-development` ou manuellement.

**Objectif :** Consolider la robustesse, la maintenabilité et l'extensibilité de l'automatisation WikiMasters sans changer le comportement externe validé.

**Architecture :** Matching local sémantique (titre + description WikiMasters) → plan de synchronisation → application idempotente par identité physique stable. Zéro dépendance réseau externe (Wikipédia retiré).

**Stack :** Node.js, Playwright-core, PowerShell (lanceurs locaux), GitHub Actions (CI), Google Sheets GViz (source de vérité dynamiques).

---

### Task 1 : Externaliser le lexique sémantique (`CONCEPT_GROUPS`) en JSON

**But :** Séparer données et code ; permettre mises à jour sans déploiement ; faciliter audits.

**Fichiers :**
- Créer : `config/concept-groups.json`
- Modifier : `wishlist.js:23-37` (supprimer tableau inline, charger JSON)
- Test : `wishlist.test.js` (ajouter test de chargement)

**Étape 1 : Écrire test d'échec**
```javascript
// wishlist.test.js
const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, 'config', 'concept-groups.json');
assert(fs.existsSync(configPath), 'config/concept-groups.json doit exister');
const groups = JSON.parse(fs.readFileSync(configPath, 'utf8'));
assert(Array.isArray(groups) && groups.length >= 8);
assert(groups.some(g => g.keys.includes('cul')));
assert(groups.some(g => g.keys.includes('sport')));
```

**Étape 2 : Exécuter test → ÉCHEC attendu**

**Étape 3 : Implémenter**
```javascript
// wishlist.js - remplacer lignes 23-37 par :
const fs = require('fs');
const path = require('path');
const CONCEPT_GROUPS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'config', 'concept-groups.json'), 'utf8')
).map(group => ({
  keys: group.keys.map(normalizeTerm),
  terms: group.terms.map(normalizeTerm)
}));
```

```json
// config/concept-groups.json
[
  { "keys": ["cul", "porno", "pornographie"], "terms": ["pornographie", "pornographique", "porno", "erotique", "erotisme", "nudite", "folle cul", "plan cul", "trou cul", "film cul"] },
  { "keys": ["sport"], "terms": ["sport", "sportif", "football", "foot", "soccer", "basket ball", "basketball", "basketteur", "joueur basket", "joueuse basket", "rugby", "tennis", "volley", "volleyball", "handball", "baseball", "softball", "cricket", "hockey", "cyclisme", "cycliste", "velo", "vtt", "marathon", "athletisme", "natation", "ski", "snowboard", "biathlon", "boxe", "judo", "karate", "taekwondo", "lutteur", "lutte sportive", "catch", "gymnastique", "golfeur", "tournoi golf", "spot surf", "surfeur", "grimpeur", "equitation", "badminton", "squash", "tennis table", "ping pong", "petanque", "escrime", "aviron", "regate", "course voilier", "triathlon", "formule 1", "f1", "rallye", "karting"] },
  { "keys": ["catch"], "terms": ["catch", "wrestling", "lutteur", "lutte sportive"] },
  { "keys": ["f1"], "terms": ["f1", "formule 1", "grand prix automobile"] },
  { "keys": ["vrou vroum"], "terms": ["moteur", "automobile", "voiture", "moto", "motocycle"] },
  { "keys": ["meteo"], "terms": ["meteo", "meteorologie", "climat", "tempete", "ouragan", "cyclone", "tornade", "pluie", "neige", "orage"] },
  { "keys": ["math", "mathematique"], "terms": ["math", "mathematique", "algebre", "geometrie", "arithmetique", "statistique", "probabilite"] }
]
```

**Étape 4 : Exécuter test → PASS. Lancer `npm run test`. Commit.**

---

### Task 2 : Améliorer `normalizeTerm` — préserver le contexte multi-mots pour les critères utilisateur

**But :** Actuellement `normalizeTerm` split + join perd la structure phrase. Pour critères utilisateur non-développés, on compare déjà via `allWords` (union), mais les exclusions et sources gagneraient à connaître la phrase originale.

**Fichiers :**
- Modifier : `wishlist.js:15-21` (`normalizeTerm`) + `explainMatches` (garder `phrase` brute)
- Test : `wishlist.test.js` (ajouter cas exclusion multi-mots)

**Étape 1 : Test échec**
```javascript
// wishlist.test.js
const card = { labels: ['#Osef'], title: 'Article', description: 'pas de sport ici' };
const wishes = [{ pseudo: 'Test', label: 'échange · Test', rules: [{ category: 'Cat', include: [], exclude: ['pas sport'], ambiguous: false }] }];
assert.deepEqual(desiredLabels(card, wishes), ['échange · Test']); // exclusion "pas sport" ne doit PAS matcher
```

**Étape 2-4 : Modifier `normalizeTerm` pour retourner `{ tokens: [...], phrase: '...' }` et adapter `explainMatches`. Commit.**

---

### Task 3 : Robustifier l'extraction d'identité physique React (`content.js:94-101`)

**But :** La détection via `__reactProps$` est fragile (clé instable entre builds React). Ajouter fallbacks : `data-physical-id` (fixtures), `data-card-id`, attribut `key` React, puis fallback logique.

**Fichiers :**
- Modifier : `content.js:94-101` (`cardPhysicalIdentity`)
- Test : `test.js` (scénario `recreate-overlap` existe déjà, vérifier couverture)

**Étape 1 : Test existant passe déjà → pas de TDD requis, amélioration défensive.**
```javascript
// content.js - renforcer cardPhysicalIdentity
const cardPhysicalIdentity = card => {
  if (card.dataset?.physicalId) return card.dataset.physicalId;
  if (card.dataset?.cardId) return `card:${card.dataset.cardId}`;
  const reactKey = Object.keys(card).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactInternalInstance$'));
  const children = card[reactKey]?.children;
  const id = (Array.isArray(children) ? children : [children])
    .find(c => c?.props?.card?.id || c?.props?.id)?.props?.card?.id || c?.props?.id;
  if (id) return `card:${id}`;
  // fallback logique stable
  const articleUrl = card.querySelector('a[href*="wikipedia.org"]')?.href || '';
  const title = cardTitle(card);
  return articleUrl ? `article:${articleUrl}` : title ? `title:${norm(title)}` : '';
};
```

**Étape 2 : Lancer `npm run test`. Commit.**

---

### Task 4 : Dédupliquer la logique de pagination / passes inventory / apply (`worker.js:127-148` et `198-216`)

**But :** Les boucles `for (;;)` d'inventaire et d'application partagent la même structure (recharger page, appeler automate, accumuler par `physicalId`, stopper si pas de progrès). Extraire en helper réutilisable.

**Fichiers :**
- Modifier : `worker.js` (créer `runMultipass(page, mode, payload, expectedPhysicalIds, onPass)`)
- Test : `npm run test` (régression)

**Étape 1 : Extraire helper**
```javascript
// worker.js - nouvelle fonction avant automate()
async function runMultipass(page, mode, basePayload, expectedPhysicalIds, onPass) {
  const coveredPhysicalIds = new Set();
  const inventoryById = new Map();
  let totalCards = expectedPhysicalIds.size;
  for (;;) {
    await page.goto(discoveredCollectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const pass = await automate(page, mode, { ...basePayload, totalCards, skipIds: [...coveredPhysicalIds] });
    onPass?.(pass, inventoryById, coveredPhysicalIds);
    for (const id of pass.physicalIds) {
      expectedPhysicalIds.add(id);
      coveredPhysicalIds.add(id);
    }
    totalCards = Math.max(totalCards, expectedPhysicalIds.size);
    const missing = [...expectedPhysicalIds].filter(id => !coveredPhysicalIds.has(id));
    if (!missing.length) break;
    if (coveredPhysicalIds.size === prevSize) throw new Error(`${mode} bloqué: ${covered}/${expectedPhysicalIds.size}`);
    prevSize = coveredPhysicalIds.size;
  }
  return { inventory: [...inventoryById.values()], physicalIds: [...coveredPhysicalIds] };
}
```

**Étape 2 : Remplacer les deux boucles. `npm run test`. Commit.**

---

### Task 5 : Ajouter métriques de performance et diagnostiques dans `wishlist-report.json`

**But :** Le rapport actuel manque de diagnostics pour déboguer faux positifs/négatifs. Ajouter : temps par phase, nombre de cartes par pseudo, règles déclenchées, cartes sans match.

**Fichiers :**
- Modifier : `worker.js:161-184` (construction `report`)
- Test : vérifier structure JSON

**Étape 1 : Enrichir rapport**
```javascript
const report = {
  // ... existant
  diagnostics: {
    phaseTimings: { pulls: 0, inventory: 0, attribution: 0, application: 0 },
    cardsByPseudo: sync.countsByPseudo,
    unmatchedCards: cards.filter(c => desiredLabels(c, wishlists).length === 0).map(c => c.title),
    ruleHits: wishlists.flatMap(w => w.cells.flatMap(c => c.raw)).reduce((acc, r) => { acc[r] = (acc[r]||0)+1; return acc; }, {}),
    expandedMatches: cards.flatMap(c => explainMatches(c, wishlists).flatMap(m => m.reasons.filter(r => CONCEPT_GROUPS.some(g => g.keys.includes(r.term))).map(r => r.term)))
  }
};
```

**Étape 2 : `npm run test`. Commit.**

---

### Task 6 : Nettoyer les artefacts de test non suivis (`failure.html`, `failure.png`) et configurer `.gitignore`

**But :** Les captures d'échec contiennent potentiellement des données de session. Ne pas committer.

**Fichiers :**
- Modifier : `.gitignore` (ajouter `failure.html`, `failure.png`, `wishlist-report.json`, `.wishlist-summary-test.md`)
- Vérifier : `git status` propre

**Étape 1 : `.gitignore`**
```
failure.html
failure.png
wishlist-report.json
.wishlist-summary-test.md
*.log
node_modules/
```

**Étape 2 : `git add .gitignore && git commit -m "chore: ignorer artefacts de test"`.**

---

### Task 7 : Documenter le matching sémantique dans `README.md` (section dédiée)

**But :** Le README mentionne le lexique mais sans exemples concrets ni procédure d'extension.

**Fichiers :**
- Modifier : `README.md` (ajouter section "Matching sémantique local")

**Contenu à ajouter :**
```markdown
## Matching sémantique local

Le classement n'utilise **que** le titre et la description courte affichés sur la carte WikiMasters.
Aucune requête Wikipédia n'est effectuée.

### Lexique d'expansion (`config/concept-groups.json`)

| Intention (clé) | Termes étendus (exemples) |
|-----------------|---------------------------|
| `cul` | pornographie, pornographique, porno, érotique, nudité, « folle cul », « plan cul », « trou cul », « film cul » |
| `sport` | football, basket, rugby, tennis, cyclisme, marathon, natation, ski, boxe, judo, gymnastique, golf, surf, escalade, équitation, aviron, course voilier, F1, rallye, karting |
| `catch` | catch, wrestling, lutteur, lutte sportive |
| `f1` | F1, formule 1, grand prix automobile |
| `meteo` | météo, climat, tempête, ouragan, tornade, pluie, neige, orage |
| `math` | math, algèbre, géométrie, arithmétique, statistique, probabilité |

### Règles de matching

1. **Critères utilisateur** (ex: `canard sauvage`) : tous les mots doivent apparaître quelque part (titre **ou** description), ordre indifférent.
2. **Alias développés** (ex: `plan cul`) : la séquence complète normalisée doit apparaître **contiguë** dans un **seul** champ (titre **ou** description).
3. **Exclusions** : même logique que les critères.
4. **Canonicalisation** : `cyclisme` ≡ `cycliste` (tronque `-isme`/`-iste`).
5. **Sources** : chaque raison cite `titre WikiMasters` et/ou `description WikiMasters`.

### Étendre le lexique

Éditer `config/concept-groups.json`, puis `npm run test`.
```

---

### Task 8 : Remplacer `WIKIPEDIA_API_URL` résiduel dans `test.js` par variable factice

**But :** Le serveur de test écoute encore `/wiki` et incrémente `wikipediaRequests`. Bien que le code prod n'appelle plus Wikipédia, le mock existe. Renommer pour clarté.

**Fichiers :**
- Modifier : `test.js:9, 23-28, 64, 73, 80, 87, 94, 101, 109, 116, 123, 130, 137, 144, 154` (renommer `wikipediaRequests` → `legacyWikiMockCalls` et commenter)

**Étape 1 : Renommage + commentaire explicatif. `npm run test`. Commit.**

---

### Task 9 : Ajouter test de régression "critère utilisateur multi-mots réparti titre+description"

**But :** Valider que le matching historique `allWords` (union) fonctionne pour critères non-développés.

**Fichiers :**
- Modifier : `wishlist.test.js` (ajouter cas `canard` titre + `sauvage` description)

**Test déjà ajouté dans Task 2. Valider qu'il passe.**

---

### Task 10 : Revue sécurité — scanner secrets, valider gestion credentials

**But :** Confirmer qu'aucun secret n'est loggé, que `credentials.xml` (DPAPI) est seul stockage, que `$credential = $null` sur échec import.

**Fichiers :**
- Lire : `wishlist-local.ps1` (vérifier `-ResetCredentials`, `$credential = $null`)
- Scanner : `git diff --cached` + `git log --all --full-history --oneline -- "*credential*"`
- Commande : `grep -r "password\|secret\|token" --include="*.js" --include="*.ps1" . | grep -v "process.env\|WIKIMASTERS_"`

**Résultat attendu : 0 fuite.**

---

### Task 11 : Lancer audit live complet (`wishlist-local.ps1 -Audit`) et valider convergence

**But :** Vérifier que le code actuel produit un audit cohérent (0 ajout/retrait si déjà synchronisé).

**Commande :**
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./wishlist-local.ps1 -Audit
```
**Critères succès :** Exit code 0, `cardsScanned` > 0, rapport JSON valide.

---

### Task 12 : Commit final + push + vérification SHA distant

**But :** Publier toutes les améliorations ensemble.

**Commandes :**
```bash
git add -A
git diff --cached --check
git commit -m "refactor: externaliser lexique, robustifier identité physique, dédupliquer multipass, enrichir rapport, doc matching"
git push origin main
git rev-parse HEAD
git ls-remote origin main
# Vérifier que les deux SHA correspondent
```

---

## Résumé des risques et arbitrages

| Risque | Atténuation |
|--------|-------------|
| Lexique JSON mal formé → crash au démarrage | Test de chargement au boot (`wishlist.js` lignes 1-2) ; validation JSON Schema possible plus tard |
| `cardPhysicalIdentity` fallback logique crée collisions | Inclure `articleUrl` dans fallback ; test `recreate-overlap` existant |
| Déduplication multipass change ordre d'exécution | Tests d'intégration `multipass-inventory`, `multipass-apply` couvrent |
| Rapport JSON plus gros → impact disque négligeable | < 1 Mo pour 2000 cartes ; acceptable |

## Questions ouvertes

1. **Faut-il versionner `config/concept-groups.json` avec hash dans le rapport ?** → Oui, ajouté `sheetHash` déjà, ajouter `lexiconHash`.
2. **Les termes `lutteur` + `lutte sportive` sont-ils redondants ?** → `lutteur` = personne, `lutte sportive` = discipline. Garder les deux.
3. **Externaliser aussi `STOP_WORDS` ?** → Non, stable et peu susceptible de changer.

---

**Plan complet. Prêt à exécuter tâche par tâche via `subagent-driven-development` ou manuellement.**