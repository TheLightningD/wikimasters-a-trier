const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { sanitizeState } = require('./session-state');

const browserCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);

(async () => {
  if (process.platform !== 'win32') throw new Error('Export disponible uniquement sous Windows.');
  const fs = require('node:fs');
  const executablePath = browserCandidates.find(candidate => fs.existsSync(candidate));
  if (!executablePath) throw new Error('Chrome ou Edge introuvable.');
  const profile = path.join(process.env.LOCALAPPDATA, 'WikiMasters-A-Trier', 'browser-profile');
  const context = await chromium.launchPersistentContext(profile, { headless: true, executablePath, locale: 'fr-FR' })
    .catch(() => { throw new Error('Fermez Chrome WikiMasters puis relancez cet export.'); });
  let state;
  try {
    state = sanitizeState({ cookies: await context.cookies(), origins: [] });
  } finally {
    await context.close();
  }

  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const verificationContext = await browser.newContext({ locale: 'fr-FR', storageState: state });
    const page = await verificationContext.newPage();
    await page.goto('https://www.wiki-masters.com/pulls', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const email = page.getByLabel(/adresse courriel|e-?mail/i);
    const openPack = page.getByRole('button', { name: /ouvrir|réclamer|récupérer/i }).first();
    const collectionLink = page.locator('a[href*="/collection"]').first();
    await Promise.race([
      email.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}),
      openPack.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}),
      collectionLink.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
    ]);
    if (await email.isVisible().catch(() => false)) {
      throw new Error('Session WikiMasters expirée. Relancez ouvrir-et-trier.cmd avant l’export.');
    }
    if (!await openPack.isVisible().catch(() => false) && !await collectionLink.isVisible().catch(() => false)) {
      throw new Error('Impossible de confirmer la session WikiMasters sur la page des paquets.');
    }
    state = sanitizeState({ cookies: await verificationContext.cookies(), origins: [] });
  } finally {
    await browser.close();
  }

  const encoded = Buffer.from(JSON.stringify(state)).toString('base64');
  const copied = spawnSync('clip.exe', { input: encoded, encoding: 'utf8' });
  if (copied.status !== 0) throw new Error('Copie vers le presse-papiers impossible.');
  console.log('Session WikiMasters copiée dans le presse-papiers.');
  console.log('Créez le secret GitHub WIKIMASTERS_SESSION_B64 et collez sa valeur.');
})().catch(error => { console.error(error.message); process.exit(1); });
