const { test, expect, chromium } = require('@playwright/test');

const BASE = 'https://powerpulse-thhr.onrender.com';

// nothing: 47.7%, respin: 45.5%, service: 3%, raffle: 2%, ecu: 1.5%, money: 0.01%
// 100 pörgetésből biztosan kijön: nothing, respin, service, raffle, ecu
// money: 0.01% — nem teszteljük automatikusan (1/10000 esély)
const REQUIRED_PRIZES = ['nothing', 'respin', 'raffle', 'service', 'ecu'];
const ALL_PRIZES = [...REQUIRED_PRIZES, 'money'];

const EXPECTED_TITLES = {
  nothing: 'Sajnos nem nyertél',
  respin:  'Pörgess újra',
  raffle:  'Bekerültél a nyereményjátékba',
  money:   '1.000.000',
  service: 'Profi szerelés',
  ecu:     'ECU',
};

test('Kerék — minden szegmens helyes eredményt mutat', async ({}, testInfo) => {
  const browser = await chromium.launch({ headless: true });
  const found = {};
  let attempts = 0;
  const MAX_ATTEMPTS = 150;

  while (
    REQUIRED_PRIZES.some(p => !found[p]) &&
    attempts < MAX_ATTEMPTS
  ) {
    attempts++;
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE}/wheel.html`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(500);
    // Maintenance overlay eltüntetése ha van
    await page.evaluate(() => {
      const overlay = document.getElementById('maintenance-overlay');
      if (overlay) overlay.remove();
      document.body.classList.remove('maintenance-mode');
    });
    await page.waitForTimeout(200);

    try {
      await page.fill('#pre-ic-name', 'Teszt_Jatekos', { timeout: 5000 });
      await page.fill('#pre-discord', 'tesztdiscord', { timeout: 3000 });
      await page.fill('#pre-phone', '06201234567', { timeout: 3000 });
      await page.locator('#spin-btn').click();
      await page.waitForSelector('#result-box.show', { timeout: 12000 });

      const title = await page.locator('#result-title').textContent();
      const emoji = await page.locator('#result-emoji').textContent();

      let prizeKey = null;
      for (const [key, keyword] of Object.entries(EXPECTED_TITLES)) {
        if (title.includes(keyword)) { prizeKey = key; break; }
      }

      if (prizeKey && !found[prizeKey]) {
        found[prizeKey] = { attempt: attempts, title: title.trim(), emoji: emoji.trim() };
        console.log(`✅ [${attempts}] ÚJ: ${prizeKey} → "${title.trim()}"`);
      } else if (prizeKey) {
        process.stdout.write('.');
      } else {
        console.log(`⚠️  [${attempts}] Ismeretlen: "${title}"`);
      }
    } catch(e) {
      process.stdout.write('x');
    }

    try { await context.close(); } catch(e) {}
  }

  await browser.close();

  // Screenshot a végeredményről — nyit egy oldalt és screenshotot csinál
  const sc_browser = await chromium.launch({ headless: true });
  const sc_page = await sc_browser.newPage();
  await sc_page.setViewportSize({ width: 800, height: 900 });
  await sc_page.setContent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: 'Segoe UI', sans-serif; background: #0a0a1a; color: #fff; padding: 40px; }
  h1 { color: #f59e0b; margin-bottom: 8px; }
  .sub { color: #888; margin-bottom: 32px; font-size: 14px; }
  .row { display: flex; align-items: center; gap: 16px; padding: 14px 20px; border-radius: 10px; margin-bottom: 10px; }
  .row.ok { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); }
  .row.fail { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); }
  .row.skip { background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); }
  .icon { font-size: 24px; width: 36px; }
  .info { flex: 1; }
  .prize { font-weight: 700; font-size: 15px; }
  .title { color: #aaa; font-size: 13px; margin-top: 2px; }
  .attempt { color: #555; font-size: 12px; }
  .footer { margin-top: 32px; color: #555; font-size: 12px; }
  .stats { background: rgba(255,255,255,0.04); border-radius: 10px; padding: 16px 20px; margin-bottom: 24px; }
  .stats span { color: #f59e0b; font-weight: 700; }
</style></head>
<body>
<h1>⚡ PowerPulse Kerék Teszt</h1>
<p class="sub">Generálva: ${new Date().toLocaleString('hu-HU')}</p>
<div class="stats">
  Összes pörgetés: <span>${attempts}</span> &nbsp;|&nbsp;
  Megtalált szegmensek: <span>${Object.keys(found).length}/${ALL_PRIZES.length}</span> &nbsp;|&nbsp;
  Kötelező szegmensek: <span>${REQUIRED_PRIZES.filter(p => found[p]).length}/${REQUIRED_PRIZES.length}</span>
</div>
${ALL_PRIZES.map(prize => {
  const data = found[prize];
  const isRequired = REQUIRED_PRIZES.includes(prize);
  const cls = data ? 'ok' : (isRequired ? 'fail' : 'skip');
  const icon = data ? '✅' : (isRequired ? '❌' : '⏭️');
  return `<div class="row ${cls}">
    <div class="icon">${icon}</div>
    <div class="info">
      <div class="prize">${prize.toUpperCase()} ${data ? data.emoji : ''}</div>
      <div class="title">${data ? data.title : (isRequired ? 'NEM JELENT MEG!' : 'Opcionális — 0.01% esély')}</div>
      ${data ? `<div class="attempt">${data.attempt}. pörgetésnél jelent meg először</div>` : ''}
    </div>
  </div>`;
}).join('')}
<p class="footer">⚡ PowerPulse ECU — Wheel Teszt Riport · ${new Date().toLocaleDateString('hu-HU')}</p>
</body></html>`);
  await sc_page.screenshot({ path: 'test-results/wheel-report.png', fullPage: true });
  await sc_browser.close();

  // Összegzés a konzolra
  console.log('\n\n========= KERÉK TESZT ÖSSZEGZÉS =========');
  console.log(`Összes pörgetés: ${attempts}/${MAX_ATTEMPTS}`);
  for (const prize of ALL_PRIZES) {
    const data = found[prize];
    const req = REQUIRED_PRIZES.includes(prize) ? '[kötelező]' : '[opcionális]';
    if (data) console.log(`  ✅ ${prize.padEnd(10)} ${req} → "${data.title}" (${data.attempt}. pörgetés)`);
    else      console.log(`  ❌ ${prize.padEnd(10)} ${req} → NEM JELENT MEG`);
  }
  console.log('=========================================\n');

  // Assert: minden kötelező szegmens megjelent
  for (const prize of REQUIRED_PRIZES) {
    expect(found[prize], `❌ "${prize}" szegmens nem jelent meg ${MAX_ATTEMPTS} pörgetésen belül!`).toBeDefined();
  }
});
