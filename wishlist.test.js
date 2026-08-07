const assert = require('node:assert/strict');
const { parseGviz, parseWishlists, parseRuleCell, explainMatches, desiredLabels, enrichCards, buildSyncPlan } = require('./wishlist');
const browserOptions = require('./browser-options');
const automationTimeout = require('./automation-timeout');

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
  description: 'Le Canard colvert est une espèce d’oiseaux.',
  metadata: 'Catégories: Oiseau, Anatidae.'
};
const wishes = [
  { pseudo: 'Canard', label: 'échange · Canard', rules: [{ category: 'Nature vivante', include: ['canard'], exclude: [], ambiguous: false }] },
  { pseudo: "zine'", label: "échange · zine'", rules: [{ category: 'Nature vivante', include: ['oiseau'], exclude: ['mammifere'], ambiguous: false }] }
];
assert.deepEqual(explainMatches(card, wishes), [
  { label: 'échange · Canard', pseudo: 'Canard', reasons: [{ category: 'Nature vivante', term: 'canard', sources: ['titre WikiMasters', 'description Wikipédia'] }] },
  { label: "échange · zine'", pseudo: "zine'", reasons: [{ category: 'Nature vivante', term: 'oiseau', sources: ['description Wikipédia'] }] }
]);
assert.deepEqual(desiredLabels(card, wishes), ['échange · Canard', "échange · zine'"]);
assert.deepEqual(desiredLabels({ ...card, title: 'Sans rapport', description: '', text: 'Canard', imageAlt: 'Canard', metadata: 'Catégorie:Canard' }, [wishes[0]]), []);
assert.deepEqual(desiredLabels({ ...card, title: "Saison d'une équipe cycliste", description: '' }, [
  { pseudo: 'Vivibike', label: 'échange · Vivibike', rules: [parseRuleCell('Cyclisme', 'Sports / Culture')] }
]), ['échange · Vivibike']);
assert.deepEqual(desiredLabels({ ...card, labels: ['favori'] }, wishes), []);
assert.deepEqual(desiredLabels({ ...card, description: `${card.description} mammifère` }, [wishes[1]]), []);
assert.deepEqual(desiredLabels(card, [{ label: 'échange · ambigu', rules: [{ include: ['canard'], exclude: [], ambiguous: true }] }]), []);

const requested = [];
const enrichedAsReported = [];
const enriched = await enrichCards([{ title: 'Canard colvert', metadata: '' }], async (url, options) => {
  requested.push(String(url));
  assert.match(options.headers['User-Agent'], /wikimasters-a-trier/i);
  return {
    ok: true,
    json: async () => ({ query: { pages: { 1: { title: 'Canard colvert', extract: 'Une espèce de canard.', categories: [{ title: 'Catégorie:Oiseau' }] } } } })
  };
}, undefined, card => enrichedAsReported.push(card.title));
assert.equal(requested.length, 1);
assert.deepEqual(enrichedAsReported, ['Canard colvert']);
assert.match(requested[0], /titles=Canard\+colvert/);
assert.equal(enriched[0].description, 'Une espèce de canard.');
assert.match(enriched[0].metadata, /espèce de canard.*Catégorie:Oiseau/);

let attempts = 0;
await enrichCards([{ title: 'Canard colvert', metadata: '' }], async () => {
  attempts++;
  if (attempts === 1) return { ok: false, status: 429, headers: { get: () => '0' } };
  return { ok: true, json: async () => ({ query: { pages: {} } }) };
});
assert.equal(attempts, 2);

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
