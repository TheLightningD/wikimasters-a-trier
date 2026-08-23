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

const fs = require('fs');
const path = require('path');
const CONCEPT_GROUPS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'config', 'concept-groups.json'), 'utf8')
).map(group => ({
  keys: group.keys.map(normalizeTerm),
  terms: group.terms.map(normalizeTerm)
}));

function semanticTerms(term) {
  const intent = term.replace(/^(?:image|photo|truc|concept|lieu)\s+/, '');
  const group = CONCEPT_GROUPS.find(item => item.keys.includes(intent));
  return { terms: group?.terms || [intent], expanded: Boolean(group) };
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

function explainMatches(card, wishlists) {
  if (!card.labels?.some(item => normalizeTerm(item) === 'osef')) return [];
  const canonicalWord = word => /^.{4,}(?:isme|iste)$/.test(word) ? word.replace(/(?:isme|iste)$/, '') : word;
  const fields = [
    ['titre WikiMasters', card.title],
    ['description WikiMasters', card.description]
  ].map(([name, text]) => {
    const words = normalizeTerm(text).split(' ').filter(Boolean).map(canonicalWord);
    return { name, words: new Set(words), phrase: ` ${words.join(' ')} ` };
  });
  const allWords = new Set(fields.flatMap(field => [...field.words]));
  const expandedMatches = (field, semantic) => semantic.terms.some(candidate => {
    const words = candidate.split(' ').map(canonicalWord);
    return words.length > 1
      ? field.phrase.includes(` ${words.join(' ')} `)
      : field.words.has(words[0]);
  });
  const matches = term => {
    const semantic = semanticTerms(term);
    return semantic.expanded
      ? fields.some(field => expandedMatches(field, semantic))
      : semantic.terms[0].split(' ').map(canonicalWord).every(word => allWords.has(word));
  };
  const sourceMatches = (field, term) => {
    const semantic = semanticTerms(term);
    return semantic.expanded
      ? expandedMatches(field, semantic)
      : semantic.terms[0].split(' ').map(canonicalWord).some(word => field.words.has(word));
  };
  // ponytail: lexique local explicable ; ajouter un modèle sémantique seulement si l'audit montre que ce vocabulaire ne suffit plus.
  return wishlists.flatMap(wishlist => {
    const rules = wishlist.rules || wishlist.cells?.map(cell => parseRuleCell(cell.raw, cell.category)) || [];
    const reasons = rules.filter(rule => !rule.ambiguous && rule.include.some(matches) && !rule.exclude.some(matches))
      .flatMap(rule => rule.include.filter(matches).map(term => ({
        category: rule.category,
        term,
        sources: fields.filter(field => sourceMatches(field, term)).map(field => field.name)
      })));
    return reasons.length ? [{ label: wishlist.label, pseudo: wishlist.pseudo || wishlist.label.slice('échange · '.length), reasons }] : [];
  });
}

function desiredLabels(card, wishlists) {
  return explainMatches(card, wishlists).map(match => match.label);
}

function buildSyncPlan(cards, wishlists) {
  const additions = [];
  const removals = [];
  let unchanged = 0;
  const countsByPseudo = {};
  for (const card of cards.filter(item => item.labels?.some(label => normalizeTerm(label) === 'osef'))) {
    const desired = new Set(desiredLabels(card, wishlists));
    const existing = new Set(card.labels);
    const common = new Set(card.commonLabels || card.labels);
    const add = [...desired].filter(label => !common.has(label));
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

module.exports = { SHEET_URL, parseGviz, parseWishlists, parseRuleCell, explainMatches, desiredLabels, buildSyncPlan, fetchWishlists };