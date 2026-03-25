const { test, chromium } = require('@playwright/test');
const BASE = 'https://powerpulse-thhr.onrender.com';

test('Spin until win', async () => {
  const browser = await chromium.launch({ headless: true });
  let attempt = 0;
  const WINS = ['raffle','money','service','ecu'];

  while (true) {
    attempt++;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/wheel.html`);
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload();
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const o = document.getElementById('maintenance-overlay');
      if (o) o.remove();
      document.body.classList.remove('maintenance-mode');
    });
    await page.waitForTimeout(200);
    try {
      await page.fill('#pre-ic-name', 'Joshua_Kullar', { timeout: 4000 });
      await page.fill('#pre-discord', 'joshuavagyok', { timeout: 3000 });
      await page.fill('#pre-phone', '06201234567', { timeout: 3000 });
      await page.locator('#spin-btn').click();
      await page.waitForSelector('#result-box.show', { timeout: 12000 });
      const title = await page.locator('#result-title').textContent();
      const emoji = await page.locator('#result-emoji').textContent();
      const isWin = WINS.some(w =>
        title.includes('szerelés') || title.includes('ECU') ||
        title.includes('nyereményjáték') || title.includes('1.000.000')
      );
      console.log(`[${attempt}] ${emoji} ${title.trim()} ${isWin ? '🎉 NYEREMÉNY!' : ''}`);
      if (isWin) {
        await page.screenshot({ path: '/root/.openclaw/workspace/win_screenshot.png', fullPage: false });
        console.log('Screenshot mentve!');
        await context.close();
        break;
      }
    } catch(e) { console.log(`[${attempt}] hiba: ${e.message.substring(0,40)}`); }
    await context.close();
    if (attempt >= 80) { console.log('80 kísérlet után nem jött nyeremény'); break; }
  }
  await browser.close();
});
