const { test, expect, chromium } = require('@playwright/test');
const BASE = 'https://powerpulse-thhr.onrender.com';
const TS = Date.now();
const IC = `Test_${TS}`;
const EMAIL = `josika886+t${TS}@gmail.com`;
const PASS = 'teszt12345';

const results = [];
function pass(name, detail='') { results.push({name, ok:true, detail}); console.log(`✅ ${name}${detail?' — '+detail:''}`); }
function fail(name, detail='') { results.push({name, ok:false, detail}); console.log(`❌ ${name}${detail?' — '+detail:''}`); }

test('PowerPulse v3.0 — Teljes teszt', async () => {
  const browser = await chromium.launch({ headless: true });

  // 1. Főoldal
  try {
    const p = await browser.newPage();
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    const title = await p.title();
    title.includes('PowerPulse') ? pass('Főoldal betölt', title) : fail('Főoldal betölt', title);
    await p.close();
  } catch(e) { fail('Főoldal betölt', e.message); }

  // 2. Login oldal
  try {
    const p = await browser.newPage();
    await p.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded' });
    const h = await p.locator('h1').first().textContent();
    pass('Login oldal', h);
    await p.close();
  } catch(e) { fail('Login oldal', e.message); }

  // 3. Regisztráció
  try {
    const p = await browser.newPage();
    await p.goto(`${BASE}/login.html`);
    await p.click('text=Regisztráció');
    await p.fill('#reg-ic', IC);
    await p.fill('#reg-discord', 'teszt_discord');
    await p.fill('#reg-email', EMAIL);
    await p.fill('#reg-pass', PASS);
    await p.fill('#reg-pass2', PASS);
    await p.click('#register-form .btn');
    await p.waitForTimeout(3000);
    const msg = await p.locator('#register-msg').textContent();
    msg.toLowerCase().includes('siker') ? pass('Regisztráció', msg.trim()) : fail('Regisztráció', msg.trim());
    await p.close();
  } catch(e) { fail('Regisztráció', e.message); }

  // 4. Bejelentkezés (nem megerősített)
  try {
    const p = await browser.newPage();
    await p.goto(`${BASE}/login.html`);
    await p.fill('#login-ic', IC);
    await p.fill('#login-pass', PASS);
    await p.click('#login-form .btn');
    await p.waitForTimeout(2000);
    const msg = await p.locator('#login-msg').textContent();
    msg.toLowerCase().includes('email') || msg.toLowerCase().includes('meger') ? pass('Email check (nem megerősített)', msg.trim()) : fail('Email check', msg.trim());
    await p.close();
  } catch(e) { fail('Email check', e.message); }

  // 5. Admin login
  let adminPage;
  try {
    adminPage = await browser.newPage();
    await adminPage.goto(`${BASE}/admin.html`);
    await adminPage.fill('#login-user', 'Joshua');
    await adminPage.fill('#login-pass', 'Hungary20030905');
    await adminPage.click('button:has-text("Belépés")');
    await adminPage.waitForTimeout(2000);
    const url = adminPage.url();
    url.includes('admin') ? pass('Admin bejelentkezés') : fail('Admin bejelentkezés', url);
  } catch(e) { fail('Admin bejelentkezés', e.message); }

  // 6. Admin: User megerősítése (direkt DB via API)
  try {
    const r = await adminPage.evaluate(async (ic) => {
      const res = await fetch('/api/admin/data');
      const data = await res.json();
      const user = data.users.find(u => u.ic_name === ic);
      return user ? user.id : null;
    }, IC);
    if (r) {
      // Force verify via admin panel (simulate)
      pass('Admin: User megtalálva', `ID: ${r.substring(0,12)}...`);
    } else {
      fail('Admin: User megtalálva', 'Nem található');
    }
  } catch(e) { fail('Admin: User adatok', e.message); }

  // 7. Profile oldal (auth nélkül → redirect)
  try {
    const p = await browser.newPage();
    await p.goto(`${BASE}/profile.html`);
    await p.waitForTimeout(2000);
    const url = p.url();
    url.includes('login') ? pass('Profil redirect (nem auth)', url) : fail('Profil redirect', url);
    await p.close();
  } catch(e) { fail('Profil redirect', e.message); }

  // 8. Garázsnapló oldal (auth nélkül)
  try {
    const p = await browser.newPage();
    await p.goto(`${BASE}/garage.html`);
    await p.waitForTimeout(2000);
    const url = p.url();
    url.includes('login') ? pass('Garázsnapló redirect', url) : fail('Garázsnapló redirect', url);
    await p.close();
  } catch(e) { fail('Garázsnapló redirect', e.message); }

  // 9-17. API végpontok
  const apis = [
    ['/api/announcements', 'Hirdetmények API'],
    ['/api/reviews', 'Vélemények API'],
    ['/api/leaderboard', 'Rangsor API'],
    ['/api/track', 'Track API'],
    ['/api/slots', 'Időpont naptár API'],
    ['/api/countdown', 'Visszaszámlálás API'],
    ['/api/seecity/status', 'SeeCity státusz API'],
  ];
  for (const [path, name] of apis) {
    try {
      const p = await browser.newPage();
      const r = await p.goto(`${BASE}${path}`);
      const text = await p.content();
      r.ok() && (text.includes('{') || text.includes('[')) ? pass(name) : fail(name, `status: ${r.status()}`);
      await p.close();
    } catch(e) { fail(name, e.message); }
  }

  // 18. Wheel oldal
  try {
    const p = await browser.newPage();
    await p.goto(`${BASE}/wheel.html`, { waitUntil: 'domcontentloaded' });
    const title = await p.title();
    title.includes('PowerPulse') ? pass('Wheel oldal betölt', title) : fail('Wheel oldal', title);
    await p.close();
  } catch(e) { fail('Wheel oldal', e.message); }

  // 19. Admin adatok
  try {
    const data = await adminPage.evaluate(async () => {
      const r = await fetch('/api/admin/data');
      return r.json();
    });
    Array.isArray(data.bookings) && Array.isArray(data.users) ? pass('Admin adatok lekérés', `${data.bookings.length} foglalás, ${data.users.length} user`) : fail('Admin adatok', JSON.stringify(data).substring(0,50));
  } catch(e) { fail('Admin adatok', e.message); }

  // 20. Referral API (auth nélkül → 401)
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/referral/link`);
    const j = JSON.parse(await p.evaluate(()=>document.body.innerText));
    j.error === 'login_required' ? pass('Referral auth check') : fail('Referral auth check', JSON.stringify(j));
    await p.close();
  } catch(e) { fail('Referral auth check', e.message); }

  // 21. Loyalty API (auth nélkül → 401)
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/loyalty`);
    const j = JSON.parse(await p.evaluate(()=>document.body.innerText));
    j.error === 'login_required' ? pass('Loyalty auth check') : fail('Loyalty auth check', JSON.stringify(j));
    await p.close();
  } catch(e) { fail('Loyalty auth check', e.message); }

  await adminPage.close();
  await browser.close();

  // Riport generálás
  const ok = results.filter(r=>r.ok).length;
  const total = results.length;
  const { chromium: cr } = require('@playwright/test');
  const rb = await cr.launch({ headless: true });
  const rp = await rb.newPage();
  await rp.setViewportSize({ width: 860, height: Math.max(600, 120 + total * 52) });
  await rp.setContent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
body{font-family:'Segoe UI',sans-serif;background:#0a0a1a;color:#fff;padding:40px;margin:0}
h1{color:#f59e0b;margin-bottom:4px;font-size:22px}
.sub{color:#666;margin-bottom:24px;font-size:13px}
.stats{background:rgba(255,255,255,0.04);border-radius:10px;padding:16px 24px;margin-bottom:24px;display:flex;gap:40px}
.stat .val{color:#f59e0b;font-size:28px;font-weight:700}
.stat .lbl{color:#666;font-size:12px;margin-top:3px}
.stat.red .val{color:#f87171}
.row{display:flex;align-items:center;gap:14px;padding:11px 18px;border-radius:8px;margin-bottom:6px}
.row.ok{background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.25)}
.row.fail{background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.25)}
.icon{font-size:16px;width:22px}
.name{flex:1;font-size:13px;font-weight:500}
.detail{color:#555;font-size:11px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.footer{margin-top:24px;color:#444;font-size:11px;text-align:center}
.badge{padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;display:inline-block;margin-bottom:20px}
.badge.green{background:rgba(34,197,94,0.12);color:#4ade80;border:1px solid rgba(34,197,94,0.4)}
.badge.red{background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.4)}
</style></head>
<body>
<h1>⚡ PowerPulse ECU — v3.0 Teljes Teszt</h1>
<p class='sub'>Generálva: ${new Date().toLocaleString('hu-HU')} · Playwright automatikus teszt</p>
<span class='badge ${ok===total?"green":"red"}'>${ok===total?"✅ MINDEN TESZT ÁTMENT":"⚠️ "+ok+"/"+total+" ÁTMENT"}</span>
<div class='stats'>
  <div class='stat'><div class='val'>${total}</div><div class='lbl'>Összes teszt</div></div>
  <div class='stat'><div class='val'>${ok}</div><div class='lbl'>Átment</div></div>
  <div class='stat ${total-ok>0?"red":""}'><div class='val'>${total-ok}</div><div class='lbl'>Sikertelen</div></div>
</div>
${results.map(r=>`<div class='row ${r.ok?"ok":"fail"}'>
  <div class='icon'>${r.ok?"✅":"❌"}</div>
  <div class='name'>${r.name}</div>
  <div class='detail'>${r.detail||''}</div>
</div>`).join('')}
<p class='footer'>⚡ PowerPulse ECU · v3.0 · ${new Date().toLocaleDateString('hu-HU')}</p>
</body></html>`);
  await rp.screenshot({ path: '/root/.openclaw/workspace/fulltest_report.png', fullPage: true });
  await rb.close();
  console.log(`\n========= VÉGEREDMÉNY: ${ok}/${total} teszt átment =========`);
  expect(ok, `${total-ok} teszt sikertelen!`).toBe(total);
});
