const assert = require('node:assert/strict');
const { parseGviz, parseWishlists, parseRuleCell, explainMatches, desiredLabels, buildSyncPlan } = require('./wishlist');
const browserOptions = require('./browser-options');
const automationTimeout = require('./automation-timeout');
const fs = require('fs');
const path = require('path');

// Test: config/concept-groups.json existe et est valide
const configPath = path.join(__dirname, 'config', 'concept-groups.json');
assert(fs.existsSync(configPath), 'config/concept-groups.json doit exister');
const groups = JSON.parse(fs.readFileSync(configPath, 'utf8'));
assert(Array.isArray(groups) && groups.length >= 7);
assert(groups.some(g => g.keys.includes('cul')));
assert(groups.some(g => g.keys.includes('sport')));

(async () => {
assert.deepEqual(browserOptions({}), {});
assert.deepEqual(browserOptions({ GITHUB_ACTIONS: 'true' }), { args: ['--no-sandbox'] });
assert.equal(automationTimeout('pulls'), 180000);
assert.equal(automationTimeout('inventory-count'), 0);
assert.equal(automationTimeout('inventory'), 0);
assert.equal(automationTimeout('wishlist-apply'), 0);

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

assert.deepEqual(parseRuleCell('Phoque / Otarie\nChèvre', 'Nature vivante'), {
  category: 'Nature vivante',
  include: ['phoque', 'otarie', 'chevre'],
  exclude: [],
  ambiguous: false
});
assert.deepEqual(parseRuleCell('Singes, oiseaux, insectes, pas de mammifères', 'Nature vivante').exclude, ['mammifere']);
assert.equal(parseRuleCell('Jeux vidéos Drapeaux Automobile', 'Sports / Culture').ambiguous, true);

const card = {
  id: 'title:canard colvert',
  title: 'Canard colvert',
  labels: ['#Osef'],
  description: 'Le Canard colvert est une espèce d\'oiseaux.',
  metadata: 'Catégories: Oiseau, Anatidae.'
};
const wishes = [
  { pseudo: 'Canard', label: 'échange · Canard', rules: [{ category: 'Nature vivante', include: ['canard'], exclude: [], ambiguous: false }] },
  { pseudo: "zine'", label: "échange · zine'", rules: [{ category: 'Nature vivante', include: ['oiseau'], exclude: ['mammifere'], ambiguous: false }] }
];
assert.deepEqual(explainMatches(card, wishes), [
  { label: 'échange · Canard', pseudo: 'Canard', reasons: [{ category: 'Nature vivante', term: 'canard', sources: ['titre WikiMasters', 'description WikiMasters'] }] },
  { label: "échange · zine'", pseudo: "zine'", reasons: [{ category: 'Nature vivante', term: 'oiseau', sources: ['description WikiMasters'] }] }
]);
assert.deepEqual(desiredLabels(card, wishes), ['échange · Canard', "échange · zine'"]);
assert.deepEqual(desiredLabels({ ...card, title: 'Sans rapport', description: '', text: 'Canard', imageAlt: 'Canard', metadata: 'Catégorie:Canard' }, [wishes[0]]), []);
assert.deepEqual(desiredLabels({ ...card, title: "Saison d'une équipe cycliste", description: '' }, [
  { pseudo: 'Vivibike', label: 'échange · Vivibike', rules: [parseRuleCell('Cyclisme', 'Sports / Culture')] }
]), ['échange · Vivibike']);
assert.deepEqual(desiredLabels({ ...card, title: 'Interprète inconnue', description: 'actrice pornographique américaine' }, [
  { pseudo: 'Cristalia', label: 'échange · Cristalia', rules: [parseRuleCell('Le CUL', 'Sports / Culture')] }
]), ['échange · Cristalia']);
assert.deepEqual(desiredLabels({ ...card, title: 'La mère de Cartman est une folle du cul', description: 'épisode de série télévisée' }, [
  { pseudo: 'Cristalia', label: 'échange · Cristalia', rules: [parseRuleCell('Le CUL', 'Sports / Culture')] }
]), ['échange · Cristalia']);
assert.deepEqual(desiredLabels({ ...card, title: 'Un film consacré à un cul-de-sac', description: 'documentaire routier' }, [
  { pseudo: 'Cristalia', label: 'échange · Cristalia', rules: [parseRuleCell('Le CUL', 'Sports / Culture')] }
]), []);
assert.deepEqual(desiredLabels({ ...card, title: 'Euroligue', description: 'compétition de basket-ball' }, [
  { pseudo: 'Sport', label: 'échange · Sport', rules: [parseRuleCell('Le sport', 'Sports / Culture')] }
]), ['échange · Sport']);
assert.deepEqual(explainMatches({ ...card, title: 'Canard', description: 'animal sauvage' }, [
  { pseudo: 'Nature', label: 'échange · Nature', rules: [parseRuleCell('canard sauvage', 'Nature vivante')] }
]), [{
  label: 'échange · Nature',
  pseudo: 'Nature',
  reasons: [{ category: 'Nature vivante', term: 'canard sauvage', sources: ['titre WikiMasters', 'description WikiMasters'] }]
}]);
for (const description of ['lutte politique', 'voile textile', 'voilier de plaisance', 'surf sur le Web', 'escalade des tensions', 'courses alimentaires']) {
  assert.deepEqual(desiredLabels({ ...card, title: 'Sans rapport', description }, [
    { pseudo: 'Sport', label: 'échange · Sport', rules: [parseRuleCell('Le sport', 'Sports / Culture')] }
  ]), []);
}
assert.deepEqual(desiredLabels({ ...card, labels: ['favori'] }, wishes), []);
assert.deepEqual(desiredLabels({ ...card, description: `${card.description} mammifère` }, [wishes[1]]), []);
assert.deepEqual(desiredLabels(card, [{ label: 'échange · ambigu', rules: [{ include: ['canard'], exclude: [], ambiguous: true }] }]), []);

const sync = buildSyncPlan([{ ...card, labels: ['#Osef', 'échange · Canard', 'échange · AncienPseudo'] }], wishes);
assert.deepEqual(sync.additions, [{ cardId: card.id, labels: ["échange · zine'"] }]);
assert.deepEqual(sync.removals, [{ cardId: card.id, labels: ['échange · AncienPseudo'] }]);
assert.equal(sync.unchanged, 0);
const converged = buildSyncPlan([{ ...card, labels: ['#Osef', 'échange · Canard', "échange · zine'"] }], wishes);
assert.deepEqual(converged.additions, []);
assert.deepEqual(converged.removals, []);
assert.equal(converged.unchanged, 1);
console.log('wishlist parser: ok');
})().catch(error => { console.error(error); process.exit(1); });