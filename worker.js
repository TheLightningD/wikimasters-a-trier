const { chromium } = require('playwright-core');
const path = require('node:path');

const pullsUrl = process.env.WM_URL || 'https://www.wiki-masters.com/pulls';
const executablePath = process.env.CHROME_PATH;

async function automate(page, mode) {
  await page.evaluate(value => { document.documentElement.dataset.wmMode = value; }, mode);
  await page.addScriptTag({ path: path.join(__dirname, 'content.js') });
  await page.waitForSelector('#wm-tri-start', { timeout: 5000 });
  await page.evaluate(() => {
    window.__wmDoneResult = null;
    document.addEventListener('wm-tri-finished', event => { window.__wmDoneResult = event.detail; }, { once: true });
  });
  await page.click('#wm-tri-start');
  await page.waitForFunction(() => window.__wmDoneResult !== null, null, { timeout: 180000 });
  const result = await page.evaluate(() => ({
    stats: window.__wmDoneResult,
    status: document.querySelector('#wm-tri-status')?.textContent || '',
    logs: window.__WM_TRI__?.logs || [],
    testVerified: window.__verifiedCount
  }));
  if (/introuvable|delai depasse|délai dépassé/i.test(result.status)) throw new Error(`${result.status} · ${result.logs.join(' > ')}`);
  return result;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ locale: 'fr-FR' });

  try {
    await page.goto(pullsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const email = page.getByLabel(/adresse courriel|e-?mail/i);
    if (await email.isVisible().catch(() => false)) {
      if (!process.env.WIKIMASTERS_EMAIL || !process.env.WIKIMASTERS_PASSWORD) {
        throw new Error('WIKIMASTERS_EMAIL et WIKIMASTERS_PASSWORD sont requis');
      }
      await email.fill(process.env.WIKIMASTERS_EMAIL);
      await page.getByLabel(/mot de passe|password/i).fill(process.env.WIKIMASTERS_PASSWORD);
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

    const pulls = await automate(page, 'pulls');
    console.log(JSON.stringify({ pulls: pulls.stats, logs: pulls.logs, ...(pulls.testVerified === undefined ? {} : { testVerified: pulls.testVerified }) }));
    if (!pulls.stats.packs) {
      const pullControls = await page.locator('button,[role="button"]').evaluateAll(items => [...new Set(items.map(item => `${item.innerText || ''} ${item.getAttribute('aria-label') || ''}`.trim()).filter(Boolean))].slice(0, 20));
      console.log(JSON.stringify({ pullControls }));
    }
    let collection = null;
    if (process.env.SCAN_COLLECTION === 'true') {
      const response = await page.goto(discoveredCollectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (response && !response.ok()) throw new Error(`Collection inaccessible (${response.status()})`);
      collection = await automate(page, 'collection');
    }

    console.log(JSON.stringify({ pulls: pulls.stats, ...(collection ? { collection: collection.stats } : {}) }));
  } catch (error) {
    await page.screenshot({ path: 'failure.png', fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
