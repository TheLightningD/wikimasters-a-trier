const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oyA_XJbYv1Tj0NGn7XBPGV6uGj7FMyiEknvds83iRic/gviz/tq?tqx=out:json&gid=0';

function parseGviz(body) {
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Réponse Google Sheets invalide');
  const payload = JSON.parse(body.slice(start, end + 1));
  if (payload.status !== 'ok' || !Array.isArray(payload.table?.rows)) throw new Error('Google Sheets indisponible');
  return payload.table;
}

const value = (row, index) => String(row?.c?.[index]?.v ?? '').trim();
const STOP_WORDS = new Set(['d', 'de', 'des', 'du', 'et', 'l', 'la', 'le', 'les', 'un', 'une']);

function normalizeTerm(input) {
  return String(input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['’]/g, ' ').replace(/[^a-z0-9+]+/g, ' ').trim().split(/\s+/)
    .filter(token => token && !STOP_WORDS.has(token))
    .map(token => token.length >= 5 && /[sx]$/.test(token) ? token.slice(0, -1) : token)
    .join(' ');
}

function parseRuleCell(raw, category) {
  const hasSeparator = /[\n,/]/.test(raw);
  const include = [];
  const exclude = [];
  for (const part of String(raw).split(/[\n,/]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const negative = /^(?:pas de|sans|sauf)\s+/i.test(trimmed);
    const term = normalizeTerm(trimmed.replace(/^(?:pas de|sans|sauf)\s+/i, ''));
    if (term) (negative ? exclude : include).push(term);
  }
  return {
    category,
    include,
    exclude,
    ambiguous: !hasSeparator && normalizeTerm(raw).split(' ').filter(Boolean).length >= 4
  };
}

function desiredLabels(card, wishlists) {
  if (!card.labels?.some(item => normalizeTerm(item) === 'osef')) return [];
  const words = new Set(normalizeTerm([card.title, card.text, card.imageAlt, card.metadata].filter(Boolean).join(' ')).split(' ').filter(Boolean));
  const matches = term => term.split(' ').every(word => words.has(word));
  // ponytail: matching textuel explicable ; ajouter vision/LLM seulement si l’audit montre des faux négatifs importants.
  return wishlists.filter(wishlist => {
    const rules = wishlist.rules || wishlist.cells?.map(cell => parseRuleCell(cell.raw, cell.category)) || [];
    return rules.some(rule => !rule.ambiguous
      && rule.include.some(matches)
      && !rule.exclude.some(matches));
  }).map(wishlist => wishlist.label);
}

function buildSyncPlan(cards, wishlists) {
  const additions = [];
  const removals = [];
  let unchanged = 0;
  const countsByPseudo = {};
  for (const card of cards.filter(item => item.labels?.some(label => normalizeTerm(label) === 'osef'))) {
    const desired = new Set(desiredLabels(card, wishlists));
    const existing = new Set(card.labels);
    const add = [...desired].filter(label => !existing.has(label));
    const remove = [...existing].filter(label => label.startsWith('échange · ') && !desired.has(label));
    if (add.length) additions.push({ cardId: card.id, labels: add });
    if (remove.length) removals.push({ cardId: card.id, labels: remove });
    if (!add.length && !remove.length) unchanged++;
    for (const label of desired) countsByPseudo[label.slice('échange · '.length)] = (countsByPseudo[label.slice('échange · '.length)] || 0) + 1;
  }
  const ambiguousRules = wishlists.flatMap(wishlist => (wishlist.rules || wishlist.cells?.map(cell => parseRuleCell(cell.raw, cell.category)) || [])
    .filter(rule => rule.ambiguous).map(rule => ({ label: wishlist.label, category: rule.category })));
  return { additions, removals, unchanged, ambiguousRules, countsByPseudo };
}

async function enrichCards(cards, fetchImpl = fetch, apiUrl = 'https://fr.wikipedia.org/w/api.php') {
  const enriched = cards.map(card => ({ ...card }));
  for (let start = 0; start < enriched.length; start += 50) {
    const batch = enriched.slice(start, start + 50);
    const url = new URL(apiUrl);
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      redirects: '1',
      prop: 'extracts|categories',
      exintro: '1',
      explaintext: '1',
      cllimit: 'max',
      titles: [...new Set(batch.map(card => card.title))].join('|')
    });
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetchImpl(url, { headers: { 'User-Agent': 'wikimasters-a-trier/1.0 (+https://github.com/TheLightningD/wikimasters-a-trier)' } });
      if (response.status !== 429) break;
      const seconds = Math.min(Number(response.headers?.get('retry-after')) || 2 ** attempt, 10);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
    if (!response.ok) throw new Error(`Wikipédia inaccessible (${response.status})`);
    const payload = await response.json();
    if (!payload.query?.pages) throw new Error('Réponse Wikipédia invalide');
    const redirects = new Map((payload.query.redirects || []).map(item => [normalizeTerm(item.from), normalizeTerm(item.to)]));
    const pages = new Map(Object.values(payload.query.pages).map(page => [normalizeTerm(page.title), page]));
    for (const card of batch) {
      const page = pages.get(redirects.get(normalizeTerm(card.title)) || normalizeTerm(card.title));
      if (!page) continue;
      card.metadata = [card.metadata, page.extract, ...(page.categories || []).map(item => item.title)].filter(Boolean).join(' ');
    }
  }
  return enriched;
}

function parseWishlists(table) {
  const rows = table.rows;
  const headerIndex = rows.findIndex(row => row.c?.some(cell => String(cell?.v ?? '').trim() === 'Pseudo'));
  if (headerIndex < 0) throw new Error('Ligne « Pseudo » introuvable');
  const header = rows[headerIndex];
  const pseudoColumn = header.c.findIndex(cell => String(cell?.v ?? '').trim() === 'Pseudo');
  const pseudoStart = pseudoColumn + 2;
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

module.exports = { SHEET_URL, parseGviz, parseWishlists, parseRuleCell, desiredLabels, buildSyncPlan, enrichCards, fetchWishlists };
