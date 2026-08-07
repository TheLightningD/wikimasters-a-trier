const { chromium } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { SHEET_URL, parseGviz, parseWishlists, explainMatches, desiredLabels, buildSyncPlan, enrichCards } = require('./wishlist');
const browserOptions = require('./browser-options');
const automationTimeout = require('./automation-timeout');

const pullsUrl = process.env.WM_URL || 'https://www.wiki-masters.com/pulls';
const executablePath = process.env.CHROME_PATH;
const printProgress = ({ phase, processed, total, title = '' }) => {
  const width = 20;
  const filled = total ? Math.min(width, Math.floor(processed * width / total)) : 0;
  console.log(`[${phase}] [${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${processed}/${total}${title ? ` — ${String(title).replace(/[\r\n]+/g, ' ')}` : ''}`);
};

async function automate(page, mode, payload) {
  await page.evaluate(value => { document.documentElement.dataset.wmMode = value; }, mode);
  if (payload !== undefined) await page.evaluate(value => { window.__WM_WISHLIST_PLAN__ = value; }, payload);
  await page.addScriptTag({ path: path.join(__dirname, 'content.js') });
  await page.waitForSelector('#wm-tri-start', { timeout: 5000 });
  await page.evaluate(() => {
    window.__wmDoneResult = null;
    document.addEventListener('wm-tri-finished', event => { window.__wmDoneResult = event.detail; }, { once: true });
  });
  await page.click('#wm-tri-start');
  await page.waitForFunction(() => window.__wmDoneResult !== null, null, { timeout: automationTimeout(mode) });
  const result = await page.evaluate(() => ({
    stats: window.__wmDoneResult,
    status: document.querySelector('#wm-tri-status')?.textContent || '',
    logs: window.__WM_TRI__?.logs || [],
    inventory: window.__WM_TRI__?.inventory || [],
    physicalIds: window.__WM_TRI__?.physicalIds || [],
    handledIds: window.__WM_TRI__?.handledIds || [],
    isTest: document.documentElement.dataset.wmTest === '1',
    testVerified: window.__verifiedCount,
    testCleanup: window.__cleanupSnapshot?.(),
    testCreatedLabels: window.__createdLabels
  }));
  if (!/Terminé|Aucun nouveau pack trouvé|Collection vérifiée|Nettoyage terminé|Comptage osef terminé|Inventaire osef terminé|Souhaits synchronisés/i.test(result.status)) {
    const error = new Error(`${result.status}${result.logs.length ? ` · ${result.logs.join(' > ')}` : ''}`);
    error.result = result;
    throw error;
  }
  return result;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
    ...browserOptions(process.env)
  });
  const page = await browser.newPage({ locale: 'fr-FR' });
  page.on('console', message => {
    const text = message.text();
    if (!text.startsWith('__WM_PROGRESS__')) return;
    try { printProgress(JSON.parse(text.slice('__WM_PROGRESS__'.length))); } catch {}
  });

  try {
    await page.goto(pullsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const email = page.getByLabel(/adresse courriel|e-?mail/i);
    if (await email.isVisible().catch(() => false)) {
      if (!process.env.WIKIMASTERS_EMAIL || !process.env.WIKIMASTERS_PASSWORD) {
        throw new Error('WIKIMASTERS_EMAIL et WIKIMASTERS_PASSWORD sont requis');
      }
      await email.pressSequentially(process.env.WIKIMASTERS_EMAIL, { delay: 10 });
      await page.getByLabel(/mot de passe|password/i).pressSequentially(process.env.WIKIMASTERS_PASSWORD, { delay: 10 });
      await page.getByRole('button', { name: /connexion|se connecter/i }).click();
      await page.waitForURL(/\/pulls(?:[/?#]|$)/, { timeout: 20000 });
    }
    if (!page.url().includes('/pulls') && !process.env.WM_URL) {
      await page.goto(pullsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    const discoveredCollectionUrl = process.env.WM_COLLECTION_URL || await page.locator('a[href]').evaluateAll(links => {
      const link = links.find(item => /collection|mes cartes/i.test(`${item.textContent} ${item.getAttribute('aria-label') || ''}`));
      return link?.href || '';
    }) || new URL('/collection', pullsUrl).href;

    const wishlistOnly = process.env.WISHLIST_ONLY === 'true';
    const collectionOnly = process.env.COLLECTION_ONLY === 'true' || wishlistOnly;
    let pullsError = null;
    let pulls = { stats: { packs: 0, cards: 0 }, logs: [wishlistOnly ? 'Packs ignorés (synchronisation d’échange locale)' : 'Packs ignorés (collection uniquement)'] };
    if (!collectionOnly) {
      try {
        pulls = await automate(page, 'pulls');
      } catch (error) {
        if (!error.result) throw error;
        pulls = error.result;
        pullsError = error;
      }
    }
    console.log(JSON.stringify({ pulls: pulls.stats, logs: pulls.logs, ...(pulls.testVerified === undefined ? {} : { testVerified: pulls.testVerified }) }));
    if (!collectionOnly && !pulls.stats.packs) {
      const pullControls = await page.locator('button,[role="button"]').evaluateAll(items => [...new Set(items.map(item => `${item.innerText || ''} ${item.getAttribute('aria-label') || ''}`.trim()).filter(Boolean))].slice(0, 20));
      console.log(JSON.stringify({ pullControls }));
    }
    let collection;
    let cleanup;
    if (!wishlistOnly) {
      const response = await page.goto(discoveredCollectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (response && !response.ok()) throw new Error(`Collection inaccessible (${response.status()})`);
      collection = await automate(page, 'collection');
      await page.goto(discoveredCollectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      cleanup = await automate(page, 'cleanup');
    }
    let wishlist = null;
    let testInventory;
    let testWishlist;
    let testCreatedLabels;
    if (process.env.WISHLIST_SYNC === 'true' || wishlistOnly) {
      await page.goto(discoveredCollectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      let count = await automate(page, 'inventory-count');
      if (!count.stats.cards) {
        await page.goto(discoveredCollectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        count = await automate(page, 'inventory-count');
      }
      let totalCards = count.stats.cards;
      const expectedPhysicalIds = new Set(count.physicalIds);
      const coveredPhysicalIds = new Set();
      console.log(`[Comptage] ${totalCards} carte(s) #Osef trouvée(s)`);
      const inventoryById = new Map();
      let inventory = { inventory: [], isTest: count.isTest };
      const missingPhysicalIds = () => [...expectedPhysicalIds].filter(id => !coveredPhysicalIds.has(id));
      for (;;) {
        const before = coveredPhysicalIds.size;
        await page.goto(discoveredCollectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const pass = await automate(page, 'inventory', { totalCards, skipIds: [...coveredPhysicalIds] });
        for (const card of pass.inventory) {
          const previous = inventoryById.get(card.id);
          inventoryById.set(card.id, previous ? {
            ...previous,
            labels: [...new Set([...previous.labels, ...card.labels])],
            commonLabels: previous.commonLabels.filter(label => card.commonLabels.includes(label))
          } : card);
        }
        for (const id of pass.physicalIds) {
          expectedPhysicalIds.add(id);
          coveredPhysicalIds.add(id);
        }
        totalCards = Math.max(totalCards, expectedPhysicalIds.size);
        const covered = expectedPhysicalIds.size - missingPhysicalIds().length;
        console.log(`[Inventaire] ${covered}/${expectedPhysicalIds.size} carte(s) physique(s) · ${inventoryById.size} référence(s) unique(s)`);
        inventory = { ...pass, inventory: [...inventoryById.values()] };
        if (!missingPhysicalIds().length && coveredPhysicalIds.size === before) break;
        if (coveredPhysicalIds.size === before) throw new Error(`Inventaire bloqué: ${covered}/${expectedPhysicalIds.size} cartes #Osef`);
      }
      const sheetResponse = await fetch(process.env.WISHLIST_SHEET_URL || SHEET_URL);
      if (!sheetResponse.ok) throw new Error(`Google Sheets inaccessible (${sheetResponse.status})`);
      const sheetBody = await sheetResponse.text();
      const wishlists = parseWishlists(parseGviz(sheetBody));
      let classified = 0;
      const cards = await enrichCards(inventory.inventory, fetch, process.env.WIKIPEDIA_API_URL, card => {
        classified++;
        printProgress({ phase: 'Attribution', processed: classified, total: inventory.inventory.length, title: card.title });
        const assignments = explainMatches(card, wishlists).map(match => ({ person: match.pseudo, label: match.label, reasons: match.reasons }));
        console.log(JSON.stringify({ exchangeCard: card.title, assignments, ...(assignments.length ? {} : { reason: 'aucun critère compatible' }) }));
      });
      const sync = buildSyncPlan(cards, wishlists);
      const report = {
        createdAt: new Date().toISOString(),
        sheetHash: crypto.createHash('sha256').update(sheetBody).digest('hex'),
        people: wishlists.length,
        rules: wishlists.reduce((sum, item) => sum + item.cells.length, 0),
        cardsScanned: cards.length,
        sourceCardsTotal: totalCards,
        additions: sync.additions.reduce((sum, item) => sum + item.labels.length, 0),
        removals: sync.removals.reduce((sum, item) => sum + item.labels.length, 0),
        ambiguousRules: sync.ambiguousRules.length,
        unchanged: sync.unchanged,
        countsByPseudo: sync.countsByPseudo,
        matches: cards.map(card => {
          const wanted = desiredLabels(card, wishlists);
          return {
            id: card.id,
            title: card.title,
            currentManagedLabels: card.labels.filter(label => label.startsWith('échange · ')),
            desiredLabels: wanted,
            additions: wanted.filter(label => !card.labels.includes(label)),
            removals: card.labels.filter(label => label.startsWith('échange · ') && !wanted.includes(label))
          };
        })
      };
      fs.writeFileSync(path.join(__dirname, 'wishlist-report.json'), `${JSON.stringify(report, null, 2)}\n`);
      wishlist = {
        cardsScanned: report.cardsScanned,
        additions: report.additions,
        removals: report.removals,
        ambiguousRules: report.ambiguousRules
      };
      if (inventory.isTest) testInventory = inventory.inventory;
      if (process.env.WISHLIST_APPLY === 'true') {
        const seenPhysicalIds = new Set();
        const handledPhysicalIds = new Set();
        const appliedTotals = { additions: 0, removals: 0 };
        const missingAppliedIds = () => [...expectedPhysicalIds].filter(id => !seenPhysicalIds.has(id));
        for (;;) {
          const before = expectedPhysicalIds.size - missingAppliedIds().length;
          await page.goto(discoveredCollectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          const applied = await automate(page, 'wishlist-apply', { ...sync, totalCards, skipIds: [...handledPhysicalIds] });
          appliedTotals.additions += applied.stats.additions;
          appliedTotals.removals += applied.stats.removals;
          for (const id of applied.physicalIds) seenPhysicalIds.add(id);
          for (const id of applied.handledIds) handledPhysicalIds.add(id);
          const covered = expectedPhysicalIds.size - missingAppliedIds().length;
          console.log(`[Application] ${covered}/${expectedPhysicalIds.size} carte(s) physique(s)`);
          if (!missingAppliedIds().length) {
            if (applied.isTest) {
              testWishlist = applied.testCleanup;
              testCreatedLabels = applied.testCreatedLabels;
            }
            break;
          }
          if (covered === before) throw new Error(`Application bloquée: ${covered}/${expectedPhysicalIds.size} cartes #Osef`);
        }
        wishlist.applied = appliedTotals;
        report.applied = wishlist.applied;
        fs.writeFileSync(path.join(__dirname, 'wishlist-report.json'), `${JSON.stringify(report, null, 2)}\n`);
      }
      if (process.env.GITHUB_STEP_SUMMARY) {
        const mode = process.env.WISHLIST_APPLY === 'true' ? 'application' : 'audit';
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
          '## Synchronisation des échanges',
          '',
          '| Mesure | Valeur |',
          '| --- | ---: |',
          `| Mode | ${mode} |`,
          `| Pseudos | ${report.people} |`,
          `| Règles | ${report.rules} |`,
          `| Cartes \`#Osef\` | ${report.cardsScanned} |`,
          `| Ajouts prévus | ${report.additions} |`,
          `| Retraits prévus | ${report.removals} |`,
          `| Règles ambiguës | ${report.ambiguousRules} |`,
          `| Empreinte feuille | \`${report.sheetHash.slice(0, 12)}\` |`,
          ''
        ].join('\n'));
      }
    }

    console.log(JSON.stringify({ pulls: pulls.stats, ...(collection ? { collection: collection.stats, cleanup: cleanup.stats, testCleanup: cleanup.testCleanup } : {}), ...(wishlist ? { wishlist } : {}), ...(testInventory ? { testInventory } : {}), ...(testWishlist ? { testWishlist, testCreatedLabels } : {}) }));
    if (pullsError) throw pullsError;
  } catch (error) {
    await page.screenshot({ path: 'failure.png', fullPage: true }).catch(() => {});
    await page.content().then(html => fs.writeFileSync('failure.html', html)).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
