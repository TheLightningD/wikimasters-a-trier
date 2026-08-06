const assert = require('node:assert/strict');
const { parseGviz, parseWishlists, parseRuleCell, desiredLabels, enrichCards, buildSyncPlan } = require('./wishlist');

(async () => {

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
  labels: ['osef'],
  metadata: 'Le Canard colvert est une espèce d’oiseaux. Catégories: Oiseau, Anatidae.'
};
const wishes = [
  { label: 'échange · Canard', rules: [{ include: ['canard'], exclude: [], ambiguous: false }] },
  { label: "échange · zine'", rules: [{ include: ['oiseau'], exclude: ['mammifere'], ambiguous: false }] }
];
assert.deepEqual(desiredLabels(card, wishes), ['échange · Canard', "échange · zine'"]);
assert.deepEqual(desiredLabels({ ...card, labels: ['favori'] }, wishes), []);
assert.deepEqual(desiredLabels({ ...card, metadata: `${card.metadata} mammifère` }, [wishes[1]]), []);
assert.deepEqual(desiredLabels(card, [{ label: 'échange · ambigu', rules: [{ include: ['canard'], exclude: [], ambiguous: true }] }]), []);

const requested = [];
const enriched = await enrichCards([{ title: 'Canard colvert', metadata: '' }], async url => {
  requested.push(String(url));
  return {
    ok: true,
    json: async () => ({ query: { pages: { 1: { title: 'Canard colvert', extract: 'Une espèce de canard.', categories: [{ title: 'Catégorie:Oiseau' }] } } } })
  };
});
assert.equal(requested.length, 1);
assert.match(requested[0], /titles=Canard\+colvert/);
assert.match(enriched[0].metadata, /espèce de canard.*Catégorie:Oiseau/);

const sync = buildSyncPlan([{ ...card, labels: ['osef', 'échange · Canard', 'échange · AncienPseudo'] }], wishes);
assert.deepEqual(sync.additions, [{ cardId: card.id, labels: ["échange · zine'"] }]);
assert.deepEqual(sync.removals, [{ cardId: card.id, labels: ['échange · AncienPseudo'] }]);
assert.equal(sync.unchanged, 0);
console.log('wishlist parser: ok');
})().catch(error => { console.error(error); process.exit(1); });
