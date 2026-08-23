const assert = require('node:assert/strict');
const { stageLine, infoLine, doneLine, progressLine, progressBucket, fullStages, stagesFor } = require('./terminal-ui');

assert.equal(stageLine(2, 5, 'Ouverture des boosters'), '[2/5] Ouverture des boosters');
assert.equal(infoLine('Navigateur', 'Chrome\nstable'), '  • Navigateur : Chrome stable');
assert.equal(infoLine('Cartes ajoutées', 0), '  • Cartes ajoutées : 0');
assert.equal(doneLine('Connexion prête', 3), '  ✓ Connexion prête · 3 s');
assert.equal(progressLine('Cartes traitées', 12, 20, 'Titre\nsur deux lignes'), '  Cartes traitées  12/20 (60 %) · Titre sur deux lignes');
assert.equal(progressBucket(1, 100), 0);
assert.equal(progressBucket(5, 100), 1);
assert.equal(progressBucket(100, 100), 20);
assert.equal(progressBucket(0, 0), 0);
assert.deepEqual(fullStages, [
  'Préparation',
  'Connexion à WikiMasters',
  'Ouverture des boosters',
  'Étiquetage des cartes sans étiquette',
  'Nettoyage de l’étiquette « à trier »'
]);

assert.deepEqual(stagesFor({ wishlistOnly: true, apply: false }), [
  'Préparation',
  'Connexion à WikiMasters',
  'Analyse des cartes #Osef',
  'Audit et rapport'
]);
assert.deepEqual(stagesFor({ wishlistSync: true, apply: true }), [
  ...fullStages,
  'Analyse des cartes #Osef',
  'Application et rapport'
]);

console.log('terminal ui: ok');
