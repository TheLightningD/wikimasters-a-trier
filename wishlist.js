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

module.exports = { SHEET_URL, parseGviz, parseWishlists, parseRuleCell, fetchWishlists };
