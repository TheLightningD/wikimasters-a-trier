const { chromium } = require('playwright-core');
const path = require('node:path');

const url = process.env.WM_URL || 'https://www.wiki-masters.com/pulls';
const executablePath = process.env.CHROME_PATH;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ locale: 'fr-FR' });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

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
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

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
      status: document.querySelector('#wm-tri-status')?.textContent || ''
    }));
    if (/introuvable|delai depasse|délai dépassé/i.test(result.status)) throw new Error(result.status);
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
