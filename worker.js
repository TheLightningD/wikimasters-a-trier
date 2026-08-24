const { chromium } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { SHEET_URL, parseGviz, parseWishlists, explainMatches, desiredLabels, buildSyncPlan } = require('./wishlist');
const browserOptions = require('./browser-options');
const automationTimeout = require('./automation-timeout');
const isSuccessfulAutomationStatus = require('./automation-status');
const { stagesFor, stageLine, infoLine, doneLine, progressLine, progressBucket } = require('./terminal-ui');

const pullsUrl = process.env.WM_URL || 'https://www.wiki-masters.com/pulls';
const executablePath = process.env.CHROME_PATH;
const cdpEndpoint = process.env.WM_CDP_ENDPOINT;
const storageStatePath = process.env.WM_STORAGE_STATE_PATH;
const storageStateOutput = process.env.WM_STORAGE_STATE_OUT;
const headless = process.env.WM_HEADLESS !== 'false';
const loginTimeout = Number(process.env.WM_LOGIN_TIMEOUT) || 20000;
const prettyOutput = process.env.WM_PRETTY_OUTPUT === 'true';
const machineOutput = process.env.WM_MACHINE_OUTPUT !== 'false';
const wishlistOnlyMode = process.env.WISHLIST_ONLY === 'true';
const wishlistSyncMode = process.env.WISHLIST_SYNC === 'true';
const wishlistApplyMode = process.env.WISHLIST_APPLY === 'true';
const collectionOnlyMode = process.env.COLLECTION_ONLY === 'true';
const manualLoginExitCode = 42;
const activeStages = stagesFor({ wishlistOnly: wishlistOnlyMode, wishlistSync: wishlistSyncMode, apply: wishlistApplyMode });
const runModeLabel = () => {
  if (wishlistOnlyMode) return wishlistApplyMode ? 'Synchronisation des échanges' : 'Audit des échanges';
  if (wishlistSyncMode) return wishlistApplyMode ? 'Ouverture, tri et échanges' : 'Ouverture, tri et audit des échanges';
  return collectionOnlyMode ? 'Collection uniquement' : 'Ouverture et tri';
};
const formatDuration = milliseconds => {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes} min ${rest} s` : `${seconds} s`;
};
const githubEscape = value => String(value || '').replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const githubCommand = (command, title, message) => {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  console.log(`::${command} title=${githubEscape(title)}::${githubEscape(message)}`);
};
const markdownCell = value => String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const writeGitHubSummary = (run, error = null) => {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const rows = [];
  const row = (name, value) => rows.push(`| ${markdownCell(name)} | ${markdownCell(value)} |`);
  if (run.pulls) {
    row('Boosters ouverts', run.pulls.stats?.packs ?? 0);
    row('Cartes de boosters traitées', run.pulls.stats?.cards ?? 0);
  }
  if (run.collection) row('Cartes ajoutées à `à trier`', run.collection.stats?.cards ?? 0);
  if (run.cleanup) row('Étiquettes `à trier` retirées', run.cleanup.stats?.cards ?? 0);
  if (run.wishlist) {
    row('Synchronisation des échanges', 'active');
    row('Mode', run.wishlist.applied ? 'application' : 'audit');
    if (run.wishlistDetails?.people !== undefined) row('Pseudos', run.wishlistDetails.people);
    if (run.wishlistDetails?.rules !== undefined) row('Règles', run.wishlistDetails.rules);
    row('Cartes `#Osef`', run.wishlist.cardsScanned);
    row('Ajouts prévus', run.wishlist.additions);
    row('Retraits prévus', run.wishlist.removals);
    row('Règles ambiguës', run.wishlist.ambiguousRules);
    if (run.wishlistDetails?.sheetHash) row('Empreinte feuille', `\`${run.wishlistDetails.sheetHash.slice(0, 12)}\``);
    if (run.wishlist.applied) {
      row('Ajouts appliqués', run.wishlist.applied.additions);
      row('Retraits appliqués', run.wishlist.applied.removals);
    }
  }
  const lines = [
    `## WikiMasters — ${error ? 'échec' : 'succès'}`,
    '',
    `| Élément | Valeur |`,
    `| --- | --- |`,
    `| Résultat | ${error ? 'Échec' : 'Succès'} |`,
    `| Mode | ${markdownCell(run.mode)} |`,
    `| Durée | ${formatDuration(Date.now() - run.startedAt)} |`,
    ...(error ? [`| Cause | ${markdownCell(error.message)} |`] : []),
    ...rows,
    ''
  ];
  if (error) {
    lines.push('### Diagnostic', '', 'Les fichiers `failure.png` et `failure.html` sont générés quand la page peut être capturée.', '');
  }
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
};
const lastProgressBuckets = new Map();
const printStage = label => {
  if (!prettyOutput) return;
  const index = activeStages.indexOf(label);
  if (index >= 0) console.log(`\n${stageLine(index + 1, activeStages.length, label)}`);
};
const printJson = value => { if (machineOutput) console.log(JSON.stringify(value)); };
const printInfo = (label, value = '') => {
  if (prettyOutput) console.log(infoLine(label, value));
  else console.log(`[${label}]${value === '' || value === null || value === undefined ? '' : ` ${String(value).replace(/[\r\n]+/g, ' ')}`}`);
};
const printProgress = ({ phase, processed, total, title = '' }) => {
  const bucket = progressBucket(processed, total);
  if (processed !== total && lastProgressBuckets.get(phase) === bucket) return;
  lastProgressBuckets.set(phase, bucket);
  if (prettyOutput) {
    console.log(progressLine(phase, processed, total, title));
    return;
  }
  const width = 20;
  const filled = total ? Math.min(width, Math.floor(processed * width / total)) : 0;
  console.log(`[${phase}] [${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${processed}/${total}${title ? ` — ${String(title).replace(/[\r\n]+/g, ' ')}` : ''}`);
};

async function acceptBlockingPopup(page) {
  const popups = page.locator('[role="dialog"],dialog,[aria-modal="true"]');
  for (let index = 0; index < await popups.count(); index++) {
    const popup = popups.nth(index);
    if (!await popup.isVisible().catch(() => false)) continue;
    const text = await popup.innerText().catch(() => '');
    if (!/(?:validation|vérification).*(?:paquet|pack|booster)|(?:paquet|pack|booster).*(?:validation|vérification)/i.test(text)) continue;
    const confirm = popup.getByRole('button', { name: /^valider$/i }).first();
    if (!await confirm.isVisible().catch(() => false)) continue;
    await confirm.click();
    await popup.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    if (prettyOutput) console.log(doneLine('Popup validé'));
    return true;
  }
  return false;
}

async function waitForEntryScreen(page, email) {
  const openPack = page.getByRole('button', { name: /ouvrir|réclamer|récupérer/i }).first();
  await Promise.race([
    email.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}),
    openPack.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}),
    page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  ]);
}

async function waitForManualSiteVerification(page) {
  const verification = page.getByText(/^Vérification rapide$/i).first();
  if (!await verification.isVisible().catch(() => false)) return false;
  if (headless && !process.env.WM_URL) {
    throw new Error('Vérification manuelle du site requise : utilisez le raccourci Windows pour ouvrir les boosters.');
  }
  if (prettyOutput) console.log(infoLine('Action requise', 'cochez « Je ne suis pas un robot », puis cliquez sur « Continuer »'));
  await page.bringToFront();
  await verification.waitFor({ state: 'hidden', timeout: 300000 }).catch(() => {
    throw new Error('Vérification rapide non terminée après 5 min.');
  });
  if (prettyOutput) console.log(doneLine('Vérification manuelle du site terminée'));
  return true;
}

const operationLabels = {
  pulls: 'Ouverture des boosters',
  collection: 'Étiquetage de la collection',
  cleanup: 'Nettoyage de la collection',
  'inventory-count': 'Comptage des cartes #Osef',
  inventory: 'Lecture des cartes #Osef',
  'wishlist-apply': 'Application des échanges'
};
const startOperation = mode => {
  const label = operationLabels[mode];
  if (!prettyOutput || !label) return () => {};
  const startedAt = Date.now();
  console.log(`  … ${label} en cours`);
  const heartbeat = setInterval(() => console.log(`  … ${label} toujours en cours · ${Math.round((Date.now() - startedAt) / 1000)} s`), 10000);
  return succeeded => {
    clearInterval(heartbeat);
    if (succeeded) console.log(doneLine(`Terminé · ${label}`, Math.round((Date.now() - startedAt) / 1000)));
  };
};

async function automate(page, mode, payload) {
  const finishOperation = startOperation(mode);
  let succeeded = false;
  try {
    await page.evaluate(value => { document.documentElement.dataset.wmMode = value; }, mode);
    if (payload !== undefined) await page.evaluate(value => { window.__WM_WISHLIST_PLAN__ = value; }, payload);
    await page.addScriptTag({ path: path.join(__dirname, 'content.js') });
    await page.waitForSelector('#wm-tri-start', { timeout: 5000 });
    await page.evaluate(() => {
      window.__wmDoneResult = null;
      document.addEventListener('wm-tri-finished', event => { window.__wmDoneResult = event.detail; }, { once: true });
    });
    await page.click('#wm-tri-start');
    await page.waitForFunction(() => window.__wmDoneResult !== null, null, { timeout: automationTimeout(mode, process.env) });
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
    if (!isSuccessfulAutomationStatus(result.status)) {
      const error = new Error(`${result.status}${result.logs.length ? ` · ${result.logs.join(' > ')}` : ''}`);
      error.result = result;
      throw error;
    }
    succeeded = true;
    return result;
  } finally {
    finishOperation(succeeded);
  }
}

(async () => {
  const startedAt = Date.now();
  const run = { startedAt, mode: runModeLabel() };
  let browser;
  let context;
  if (cdpEndpoint) {
    browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 30000 });
    context = browser.contexts()[0];
  } else if (storageStatePath) {
    browser = await chromium.launch({
      headless,
      ...(executablePath ? { executablePath } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
      ...browserOptions(process.env)
    });
    context = await browser.newContext({ locale: 'fr-FR', storageState: storageStatePath });
  } else {
    browser = await chromium.launchPersistentContext(process.env.WM_BROWSER_PROFILE || '', {
      headless,
      locale: 'fr-FR',
      ...(executablePath ? { executablePath } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
      ...browserOptions(process.env)
    });
    context = browser;
  }
  const page = context.pages().find(item => /wiki-masters\.com/i.test(item.url())) || context.pages()[0] || await context.newPage();
  let sessionAuthenticated = false;
  page.on('console', message => {
    const text = message.text();
    if (!text.startsWith('__WM_PROGRESS__')) return;
    try { printProgress(JSON.parse(text.slice('__WM_PROGRESS__'.length))); } catch {}
  });

  try {
    printStage('Connexion à WikiMasters');
    if (prettyOutput) console.log('  … Connexion en cours');
    await page.goto(pullsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const email = page.getByLabel(/adresse courriel|e-?mail/i);
    await waitForEntryScreen(page, email);
    await acceptBlockingPopup(page);
    if (await email.isVisible().catch(() => false)) {
      if (!process.env.WIKIMASTERS_EMAIL || !process.env.WIKIMASTERS_PASSWORD) {
        throw new Error('WIKIMASTERS_EMAIL et WIKIMASTERS_PASSWORD sont requis');
      }
      await email.fill(process.env.WIKIMASTERS_EMAIL);
      await page.getByLabel(/mot de passe|password/i).fill(process.env.WIKIMASTERS_PASSWORD);
      const loginForm = email.locator('xpath=ancestor::form[1]');
      const login = loginForm.locator('button[type="submit"]').filter({ hasText: /^(?:Connexion|Se connecter)$/i });
      if (await login.count() !== 1) throw new Error('Bouton de connexion unique introuvable');
      await acceptBlockingPopup(page);
      if (await login.isDisabled()) {
        const waitMs = Number(process.env.WM_CLOUDFLARE_WAIT_MS) || 15000;
        if (prettyOutput) console.log(infoLine('Cloudflare', 'attente de la validation automatique'));
        const deadline = Date.now() + waitMs;
        while (await login.isDisabled().catch(() => false) && Date.now() < deadline) {
          await page.waitForTimeout(Math.min(500, deadline - Date.now()));
        }
        if (!await login.isDisabled().catch(() => false) && prettyOutput) {
          console.log(doneLine('Validation Cloudflare automatique terminée'));
        }
      }
      if (await login.isDisabled()) {
        if (process.env.WM_MANUAL_LOGIN_HANDOFF === 'true' && !cdpEndpoint) {
          const error = new Error('Connexion manuelle Cloudflare requise dans Chrome normal.');
          error.exitCode = manualLoginExitCode;
          throw error;
        }
        if (headless) throw new Error('Validation Cloudflare requise : lancez le raccourci Windows et validez la vérification dans Chrome.');
        if (prettyOutput) console.log('  … Validation Cloudflare requise dans la fenêtre Chrome');
        if (prettyOutput) console.log(infoLine('Navigateur', cdpEndpoint ? 'Chrome normal, connexion automatique dès validation' : 'cochez « Vérifiez que vous êtes humain » dans Chrome'));
        await page.bringToFront();
        await login.click({ timeout: 300000 }).catch(() => {
          throw new Error('Validation Cloudflare non terminée après 5 min. Fermez Chrome, relancez le raccourci puis validez la case affichée.');
        });
        if (prettyOutput) console.log(doneLine('Validation Cloudflare terminée'));
      } else {
        await login.click();
      }
      const openPack = page.getByRole('button', { name: /ouvrir|réclamer|récupérer/i }).first();
      await Promise.any([
        email.waitFor({ state: 'hidden', timeout: loginTimeout }),
        openPack.waitFor({ state: 'visible', timeout: loginTimeout })
      ]).catch(() => {});
      if (await email.isVisible().catch(() => false)) {
        const alert = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
        throw new Error(`Connexion non confirmée${alert.length ? ` : ${alert.join(' ')}` : ''}`);
      }
    }
    await waitForEntryScreen(page, email);
    await acceptBlockingPopup(page);
    if (!page.url().includes('/pulls') && !process.env.WM_URL) {
      await page.goto(pullsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    const discoveredCollectionUrl = process.env.WM_COLLECTION_URL || await page.locator('a[href]').evaluateAll(links => {
      const link = links.find(item => /collection|mes cartes/i.test(`${item.textContent} ${item.getAttribute('aria-label') || ''}`));
      return link?.href || '';
    }) || new URL('/collection', pullsUrl).href;
    sessionAuthenticated = !await email.isVisible().catch(() => true);
    if (!sessionAuthenticated) throw new Error('Session WikiMasters non authentifiée.');
    if (prettyOutput) console.log(doneLine('Connexion prête'));

    const wishlistOnly = wishlistOnlyMode;
    const collectionOnly = collectionOnlyMode || wishlistOnly;
    let pullsError = null;
    let pulls = { stats: { packs: 0, cards: 0 }, logs: [wishlistOnly ? 'Packs ignorés (synchronisation d’échange locale)' : 'Packs ignorés (collection uniquement)'] };
    if (!collectionOnly) {
      printStage('Ouverture des boosters');
      await waitForManualSiteVerification(page);
      try {
        pulls = await automate(page, 'pulls');
      } catch (error) {
        if (!error.result) throw error;
        pulls = error.result;
        pullsError = error;
      }
    }
    run.pulls = pulls;
    printJson({ pulls: pulls.stats, logs: pulls.logs, ...(pulls.testVerified === undefined ? {} : { testVerified: pulls.testVerified }) });
    if (!collectionOnly && !pulls.stats.packs) {
      const pullControls = await page.locator('button,[role="button"]').evaluateAll(items => [...new Set(items.map(item => `${item.innerText || ''} ${item.getAttribute('aria-label') || ''}`.trim()).filter(Boolean))].slice(0, 20));
      printJson({ pullControls });
    }
    let collection;
    let cleanup;
    if (!wishlistOnly) {
      printStage('Étiquetage des cartes sans étiquette');
      const response = await page.goto(discoveredCollectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (response && !response.ok()) throw new Error(`Collection inaccessible (${response.status()})`);
      collection = await automate(page, 'collection');
      run.collection = collection;
      printStage('Nettoyage de l’étiquette « à trier »');
      await page.goto(discoveredCollectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      cleanup = await automate(page, 'cleanup');
      run.cleanup = cleanup;
    }
    let wishlist = null;
    let testInventory;
    let testWishlist;
    let testCreatedLabels;
    if (wishlistSyncMode || wishlistOnly) {
      printStage('Analyse des cartes #Osef');
      await page.goto(discoveredCollectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      let count = await automate(page, 'inventory-count');
      if (!count.stats.cards) {
        await page.goto(discoveredCollectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        count = await automate(page, 'inventory-count');
      }
      let totalCards = count.stats.cards;
      const expectedPhysicalIds = new Set(count.physicalIds);
      const coveredPhysicalIds = new Set();
      printInfo('Comptage', `${totalCards} carte(s) #Osef trouvée(s)`);
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
        printInfo('Inventaire', `${covered}/${expectedPhysicalIds.size} carte(s) physique(s), ${inventoryById.size} référence(s) unique(s)`);
        inventory = { ...pass, inventory: [...inventoryById.values()] };
        if (!missingPhysicalIds().length && coveredPhysicalIds.size === before) break;
        if (coveredPhysicalIds.size === before) throw new Error(`Inventaire bloqué: ${covered}/${expectedPhysicalIds.size} cartes #Osef`);
      }
      const sheetResponse = await fetch(process.env.WISHLIST_SHEET_URL || SHEET_URL);
      if (!sheetResponse.ok) throw new Error(`Google Sheets inaccessible (${sheetResponse.status})`);
      const sheetBody = await sheetResponse.text();
      const wishlists = parseWishlists(parseGviz(sheetBody));
      const cards = inventory.inventory;
      cards.forEach((card, index) => {
        printProgress({ phase: 'Attribution', processed: index + 1, total: cards.length, title: card.title });
        const assignments = explainMatches(card, wishlists).map(match => ({ person: match.pseudo, label: match.label, reasons: match.reasons }));
        printJson({ exchangeCard: card.title, assignments, ...(assignments.length ? {} : { reason: 'aucun critère compatible' }) });
      });
      const sync = buildSyncPlan(cards, wishlists);
      printStage(`${wishlistApplyMode ? 'Application' : 'Audit'} et rapport`);
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
      run.wishlistDetails = { people: report.people, rules: report.rules, sheetHash: report.sheetHash };
      run.wishlist = wishlist;
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
          printInfo('Application', `${covered}/${expectedPhysicalIds.size} carte(s) physique(s)`);
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
        run.wishlist = wishlist;
        report.applied = wishlist.applied;
        fs.writeFileSync(path.join(__dirname, 'wishlist-report.json'), `${JSON.stringify(report, null, 2)}\n`);
      }
    }

    const finalResult = { pulls: pulls.stats, ...(collection ? { collection: collection.stats, cleanup: cleanup.stats, testCleanup: cleanup.testCleanup } : {}), ...(wishlist ? { wishlist } : {}), ...(testInventory ? { testInventory } : {}), ...(testWishlist ? { testWishlist, testCreatedLabels } : {}) };
    printJson(finalResult);
    if (prettyOutput) {
      console.log('\nRésumé');
      if (collection) {
        console.log(infoLine('Boosters ouverts', pulls.stats.packs));
        console.log(infoLine('Cartes de boosters traitées', pulls.stats.cards));
        console.log(infoLine('Cartes ajoutées à « à trier »', collection.stats.cards));
        console.log(infoLine('Étiquettes « à trier » retirées', cleanup.stats.cards));
      } else if (wishlist) {
        console.log(infoLine('Cartes #Osef analysées', wishlist.cardsScanned));
        console.log(infoLine('Ajouts / retraits prévus', `${wishlist.additions} / ${wishlist.removals}`));
      }
      console.log(infoLine('Durée', formatDuration(Date.now() - startedAt)));
    }
    if (pullsError) throw pullsError;
    writeGitHubSummary(run);
    githubCommand('notice', 'WikiMasters', `${run.mode} terminé en ${formatDuration(Date.now() - startedAt)}`);
  } catch (error) {
    if (error.exitCode !== manualLoginExitCode) {
      await page.locator('input, textarea').evaluateAll(fields => fields.forEach(field => {
        field.value = '';
        field.setAttribute('value', '');
        field.textContent = '';
      })).catch(() => {});
      await page.screenshot({ path: 'failure.png', fullPage: true }).catch(() => {});
      await page.content().then(html => fs.writeFileSync('failure.html', html)).catch(() => {});
      writeGitHubSummary(run, error);
      githubCommand('error', 'WikiMasters', error.message);
    }
    throw error;
  } finally {
    try {
      if (sessionAuthenticated && storageStateOutput) await context.storageState({ path: storageStateOutput });
    } finally {
      await browser.close();
    }
  }
})().catch(error => {
  const label = error.exitCode === manualLoginExitCode ? 'PAUSE' : 'ÉCHEC';
  console.error(prettyOutput ? `\n${label} : ${error.message}` : error.message);
  process.exit(error.exitCode || 1);
});
