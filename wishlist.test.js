const assert = require('node:assert/strict');
const { parseGviz, parseWishlists, parseRuleCell } = require('./wishlist');

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
console.log('wishlist parser: ok');
