const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = __dirname;
const reportPath = path.join(root, 'wishlist-report.json');
const summaryPath = path.join(root, '.wishlist-summary-test.md');
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const pathname = url.pathname;
  if (pathname === '/sheet') {
    response.end(`google.visualization.Query.setResponse(${JSON.stringify({
      status: 'ok',
      table: { rows: [
        { c: [{ v: null }, { v: 'Pseudo' }, { v: null }, { v: 'Canard' }, { v: 'AncienPseudo2' }] },
        { c: [{ v: null }, { v: 'Trucs recherchés' }, { v: 'Nature vivante' }, { v: 'Canard' }, { v: 'Canard' }] }
      ] }
    })});`);
    return;
  }
  if (pathname === '/wiki') {
    const title = url.searchParams.get('titles') || '';
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ query: { pages: { 1: { title, extract: 'Une espèce de canard.', categories: [{ title: 'Catégorie:Oiseau' }] } } } }));
    return;
  }
  const file = path.join(root, pathname === '/' ? 'test.html' : pathname.slice(1));
  if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
  fs.createReadStream(file).pipe(response);
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  fs.rmSync(reportPath, { force: true });
  fs.rmSync(summaryPath, { force: true });
  const run = extraEnv => new Promise(resolve => {
    const child = spawn(process.execPath, ['worker.js'], {
      cwd: root,
      env: {
        ...process.env,
        WM_URL: `http://127.0.0.1:${port}/test.html`,
        WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html`,
        SCAN_COLLECTION: 'true',
        ...extraEnv
      }
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('close', code => resolve({ code, output }));
  });

  const success = await run();
  const automatic = await run({ SCAN_COLLECTION: 'false' });
  const empty = await run({ COLLECTION_ONLY: 'true', SCAN_COLLECTION: 'false', WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1` });
  const inventory = await run({
    WISHLIST_ONLY: 'true',
    WISHLIST_APPLY: 'false',
    WISHLIST_SHEET_URL: `http://127.0.0.1:${port}/sheet`,
    WIKIPEDIA_API_URL: `http://127.0.0.1:${port}/wiki`,
    GITHUB_STEP_SUMMARY: summaryPath,
    WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1&details-only-labels=1`
  });
  const auditSummary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : '';
  const inventoryAfterZero = await run({
    WISHLIST_ONLY: 'true',
    WISHLIST_APPLY: 'false',
    WISHLIST_SHEET_URL: `http://127.0.0.1:${port}/sheet`,
    WIKIPEDIA_API_URL: `http://127.0.0.1:${port}/wiki`,
    WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1&details-only-labels=1&zero-count=1`
  });
  const inventoryMultipass = await run({
    WISHLIST_ONLY: 'true',
    WISHLIST_APPLY: 'false',
    WISHLIST_SHEET_URL: `http://127.0.0.1:${port}/sheet`,
    WIKIPEDIA_API_URL: `http://127.0.0.1:${port}/wiki`,
    WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1&details-only-labels=1&multipass-inventory=1`
  });
  const cyclicPagination = await run({
    WISHLIST_ONLY: 'true',
    WISHLIST_APPLY: 'false',
    WISHLIST_SHEET_URL: `http://127.0.0.1:${port}/sheet`,
    WIKIPEDIA_API_URL: `http://127.0.0.1:${port}/wiki`,
    WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1&details-only-labels=1&cycle=1`
  });
  const wishlistApply = await run({
    WISHLIST_ONLY: 'true',
    WISHLIST_APPLY: 'true',
    WISHLIST_SHEET_URL: `http://127.0.0.1:${port}/sheet`,
    WIKIPEDIA_API_URL: `http://127.0.0.1:${port}/wiki`,
    WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1&details-only-labels=1&slow-removal=1`
  });
  const appliedReport = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
  const wishlistApplyMultipass = await run({
    WISHLIST_ONLY: 'true',
    WISHLIST_APPLY: 'true',
    WISHLIST_SHEET_URL: `http://127.0.0.1:${port}/sheet`,
    WIKIPEDIA_API_URL: `http://127.0.0.1:${port}/wiki`,
    WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1&details-only-labels=1&multipass-apply=1`
  });
  const wishlistApplyDuplicates = await run({
    WISHLIST_ONLY: 'true',
    WISHLIST_APPLY: 'true',
    WISHLIST_SHEET_URL: `http://127.0.0.1:${port}/sheet`,
    WIKIPEDIA_API_URL: `http://127.0.0.1:${port}/wiki`,
    WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1&details-only-labels=1&duplicate-apply=1`
  });
  const wishlistApplyStale = await run({
    WISHLIST_ONLY: 'true',
    WISHLIST_APPLY: 'true',
    WISHLIST_SHEET_URL: `http://127.0.0.1:${port}/sheet`,
    WIKIPEDIA_API_URL: `http://127.0.0.1:${port}/wiki`,
    WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1&details-only-labels=1&stale-removal=1&recreate-overlap=1&selection-reorder=1`
  });
  const wishlistApplyFailure = await run({
    WISHLIST_ONLY: 'true',
    WISHLIST_APPLY: 'true',
    WISHLIST_SHEET_URL: `http://127.0.0.1:${port}/sheet`,
    WIKIPEDIA_API_URL: `http://127.0.0.1:${port}/wiki`,
    WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1&details-only-labels=1&exchange-failure=1`
  });
  const limited = await run({ SCAN_COLLECTION: 'false', WM_URL: `http://127.0.0.1:${port}/test.html?limit=1` });
  const brokenPull = await run({
    SCAN_COLLECTION: 'false',
    WISHLIST_SYNC: 'true',
    WISHLIST_APPLY: 'false',
    WISHLIST_SHEET_URL: `http://127.0.0.1:${port}/sheet`,
    WIKIPEDIA_API_URL: `http://127.0.0.1:${port}/wiki`,
    WM_URL: `http://127.0.0.1:${port}/test.html?pull-error=1`,
    WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1&details-only-labels=1`
  });
  const failure = await run({ COLLECTION_ONLY: 'true', WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?failure=1` });
  server.close();
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
  fs.rmSync(reportPath, { force: true });
  fs.rmSync(summaryPath, { force: true });
  if (!inventory.output.includes('[Inventaire]') || !inventory.output.includes('2/2') || !wishlistApply.output.includes('[Application]') || !wishlistApply.output.includes('2/2')) {
    console.error(inventory.output.trim(), wishlistApply.output.trim());
    process.exit(1);
  }
  if (inventoryAfterZero.code !== 0 || inventoryAfterZero.output.includes('[Comptage] 0 carte(s)') || !inventoryAfterZero.output.includes('"cardsScanned":1')) {
    console.error(inventoryAfterZero.output.trim());
    process.exit(1);
  }
  if (inventoryMultipass.code !== 0 || !inventoryMultipass.output.includes('[Comptage] 0 carte(s)') || !inventoryMultipass.output.includes('"cardsScanned":2')) {
    console.error(inventoryMultipass.output.trim());
    process.exit(1);
  }
  if (cyclicPagination.code === 0 || !cyclicPagination.output.includes('Pagination cyclique')) {
    console.error(cyclicPagination.output.trim());
    process.exit(1);
  }
  if (wishlistApplyMultipass.code !== 0 || !wishlistApplyMultipass.output.includes('[Application] 2/2 carte(s) physique(s)') || !wishlistApplyMultipass.output.includes('"applied":{"additions":2,"removals":2}')) {
    console.error(wishlistApplyMultipass.output.trim());
    process.exit(1);
  }
  if (wishlistApplyDuplicates.code !== 0 || !wishlistApplyDuplicates.output.includes('[Application] 2/2 carte(s) physique(s)') || !wishlistApplyDuplicates.output.includes('"applied":{"additions":2,"removals":2}')) {
    console.error(wishlistApplyDuplicates.output.trim());
    process.exit(1);
  }
  if (wishlistApplyFailure.code === 0 || !wishlistApplyFailure.output.includes('[Application]') || !wishlistApplyFailure.output.includes('2/2') || !wishlistApplyFailure.output.includes('après 2/2 cartes')) {
    console.error(wishlistApplyFailure.output.trim());
    process.exit(1);
  }
  if (wishlistApplyStale.code !== 0 || !wishlistApplyStale.output.includes('"applied":{"additions":1,"removals":1}')) {
    console.error(wishlistApplyStale.output.trim());
    process.exit(1);
  }
  if (!auditSummary.includes('Synchronisation des échanges') || !auditSummary.includes('Mode | audit') || !auditSummary.includes('Cartes `#Osef` | 1') || auditSummary.includes('Canard colvert') || success.code !== 0 || !success.output.includes('"packs":2') || !success.output.includes('"collection":{"packs":0,"cards":2}') || !success.output.includes('"cleanup":{"packs":0,"cards":2}') || !success.output.includes('"target-only":["à trier"]') || !success.output.includes('"target-other":["favori"]') || !success.output.includes('"target-others":["favori","rare"]') || !success.output.includes('"other-only":["favori"]') || !success.output.includes('"testVerified":6') || automatic.code !== 0 || !automatic.output.includes('"packs":2,"cards":6') || !automatic.output.includes('"cleanup":{"packs":0,"cards":2}') || empty.code !== 0 || !empty.output.includes('"collection":{"packs":0,"cards":0}') || !empty.output.includes('"cleanup":{"packs":0,"cards":2}') || inventory.code !== 0 || !inventory.output.includes('Packs ignorés (synchronisation d’échange locale)') || !inventory.output.includes('"wishlist":{"cardsScanned":1,"additions":1,"removals":1,"ambiguousRules":0}') || !inventory.output.includes('"labels":["#Osef","échange · AncienPseudo2","échange · AncienPseudo"]') || !inventory.output.includes('"exchangeCard":"Canard colvert"') || !inventory.output.includes('"person":"Canard"') || !inventory.output.includes('"category":"Nature vivante"') || !inventory.output.includes('"term":"canard"') || wishlistApply.code !== 0 || !wishlistApply.output.includes('"applied":{"additions":1,"removals":1}') || !wishlistApply.output.includes('"osef-card":["#Osef","échange · AncienPseudo2","échange · Canard"]') || !wishlistApply.output.includes('"testCreatedLabels":["échange · Canard"]') || !report || !appliedReport || report.cardsScanned !== 1 || report.additions !== 1 || report.removals !== 1 || report.ambiguousRules !== 0 || appliedReport.applied?.additions !== 1 || appliedReport.applied?.removals !== 1 || report.matches[0]?.title !== 'Canard colvert' || !report.matches[0]?.currentManagedLabels.includes('échange · AncienPseudo') || limited.code !== 0 || !limited.output.includes('"packs":1,"cards":3') || !limited.output.includes('"cleanup":{"packs":0,"cards":2}') || !limited.output.includes('Limite quotidienne') || brokenPull.code === 0 || !brokenPull.output.includes('"cleanup":{"packs":0,"cards":2}') || !brokenPull.output.includes('"wishlist":{"cardsScanned":1,"additions":1,"removals":1,"ambiguousRules":0}') || !brokenPull.output.includes('commande d’étiquette introuvable') || failure.code === 0 || !failure.output.includes('Retrait « à trier » non confirmé')) {
    console.error(success.output.trim(), automatic.output.trim(), empty.output.trim(), inventory.output.trim(), wishlistApply.output.trim(), limited.output.trim(), brokenPull.output.trim(), failure.output.trim());
    process.exit(1);
  }
  console.log(success.output.trim());
  console.log('Retrait non confirmé: échec explicite vérifié');
});
