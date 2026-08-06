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
    COLLECTION_ONLY: 'true',
    WISHLIST_SYNC: 'true',
    WISHLIST_APPLY: 'false',
    WISHLIST_SHEET_URL: `http://127.0.0.1:${port}/sheet`,
    WIKIPEDIA_API_URL: `http://127.0.0.1:${port}/wiki`,
    GITHUB_STEP_SUMMARY: summaryPath,
    WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1&details-only-labels=1`
  });
  const auditSummary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : '';
  const wishlistApply = await run({
    COLLECTION_ONLY: 'true',
    WISHLIST_SYNC: 'true',
    WISHLIST_APPLY: 'true',
    WISHLIST_SHEET_URL: `http://127.0.0.1:${port}/sheet`,
    WIKIPEDIA_API_URL: `http://127.0.0.1:${port}/wiki`,
    WM_COLLECTION_URL: `http://127.0.0.1:${port}/collection.html?all-labeled=1&details-only-labels=1`
  });
  const appliedReport = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
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
  if (!auditSummary.includes('Synchronisation des échanges') || !auditSummary.includes('Mode | audit') || !auditSummary.includes('Cartes `osef` | 1') || auditSummary.includes('Canard colvert') || success.code !== 0 || !success.output.includes('"packs":2') || !success.output.includes('"collection":{"packs":0,"cards":2}') || !success.output.includes('"cleanup":{"packs":0,"cards":2}') || !success.output.includes('"target-only":["à trier"]') || !success.output.includes('"target-other":["favori"]') || !success.output.includes('"target-others":["favori","rare"]') || !success.output.includes('"other-only":["favori"]') || !success.output.includes('"testVerified":6') || automatic.code !== 0 || !automatic.output.includes('"packs":2,"cards":6') || !automatic.output.includes('"cleanup":{"packs":0,"cards":2}') || empty.code !== 0 || !empty.output.includes('"collection":{"packs":0,"cards":0}') || !empty.output.includes('"cleanup":{"packs":0,"cards":2}') || inventory.code !== 0 || !inventory.output.includes('"wishlist":{"cardsScanned":1,"additions":1,"removals":1,"ambiguousRules":0}') || !inventory.output.includes('"labels":["Osef","échange · AncienPseudo2","échange · AncienPseudo"]') || wishlistApply.code !== 0 || !wishlistApply.output.includes('"applied":{"additions":1,"removals":1}') || !wishlistApply.output.includes('"osef-card":["Osef","échange · AncienPseudo2","échange · Canard"]') || !wishlistApply.output.includes('"testCreatedLabels":["échange · Canard"]') || !report || !appliedReport || report.cardsScanned !== 1 || report.additions !== 1 || report.removals !== 1 || report.ambiguousRules !== 0 || appliedReport.applied?.additions !== 1 || appliedReport.applied?.removals !== 1 || report.matches[0]?.title !== 'Canard colvert' || !report.matches[0]?.currentManagedLabels.includes('échange · AncienPseudo') || limited.code !== 0 || !limited.output.includes('"packs":1,"cards":3') || !limited.output.includes('"cleanup":{"packs":0,"cards":2}') || !limited.output.includes('Limite quotidienne') || brokenPull.code === 0 || !brokenPull.output.includes('"cleanup":{"packs":0,"cards":2}') || !brokenPull.output.includes('"wishlist":{"cardsScanned":1,"additions":1,"removals":1,"ambiguousRules":0}') || !brokenPull.output.includes('commande d’étiquette introuvable') || failure.code === 0 || !failure.output.includes('Retrait « à trier » non confirmé')) {
    console.error(success.output.trim(), automatic.output.trim(), empty.output.trim(), inventory.output.trim(), wishlistApply.output.trim(), limited.output.trim(), brokenPull.output.trim(), failure.output.trim());
    process.exit(1);
  }
  console.log(success.output.trim());
  console.log('Retrait non confirmé: échec explicite vérifié');
});
