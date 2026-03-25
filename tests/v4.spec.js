const { test, expect, chromium } = require('@playwright/test');
const BASE = 'https://powerpulse-thhr.onrender.com';
const TS = Date.now();
const IC = `Test_${TS}`;
const EMAIL = `josika886+t${TS}@gmail.com`;
const PASS = 'teszt12345';

const results = [];
function pass(name, detail='') { results.push({name, ok:true, detail}); console.log(`✅ ${name}${detail?' — '+detail:''}`); }
function fail(name, detail='') { results.push({name, ok:false, detail}); console.log(`❌ ${name}${detail?' — '+detail:''}`); }

test('PowerPulse v4.0 — Teljes teszt', async () => {
  const browser = await chromium.launch({ headless: true });

  // 1. Főoldal
  try {
    const p = await browser.newPage();
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    const title = await p.title();
    title.includes('PowerPulse') ? pass('Főoldal betölt', title) : fail('Főoldal betölt', title);
    await p.close();
  } catch(e) { fail('Főoldal betölt', e.message); }

  // 2. Manifest (PWA)
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/manifest.json`);
    const json = await r.json();
    json.name && json.start_url ? pass('PWA Manifest', json.name) : fail('PWA Manifest', JSON.stringify(json));
    await p.close();
  } catch(e) { fail('PWA Manifest', e.message); }

  // 3. Service Worker fájl
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/sw.js`);
    const text = await p.content();
    text.includes('push') ? pass('Service Worker (sw.js)', 'Push handler megvan') : fail('Service Worker', 'Push handler hiányzik');
    await p.close();
  } catch(e) { fail('Service Worker', e.message); }

  // 4. Login oldal
  try {
    const p = await browser.newPage();
    await p.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded' });
    pass('Login oldal betölt');
    await p.close();
  } catch(e) { fail('Login oldal', e.message); }

  // 5. Regisztráció
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
    msg.toLowerCase().includes('siker') ? pass('Regisztráció', msg.trim().substring(0,50)) : fail('Regisztráció', msg.trim());
    await p.close();
  } catch(e) { fail('Regisztráció', e.message); }

  // 6. Admin login
  let adminPage;
  try {
    adminPage = await browser.newPage();
    await adminPage.goto(`${BASE}/admin.html`);
    await adminPage.fill('#login-user', 'Joshua');
    await adminPage.fill('#login-pass', 'Hungary20030905');
    await adminPage.click('button:has-text("Belépés")');
    await adminPage.waitForTimeout(2000);
    pass('Admin bejelentkezés');
  } catch(e) { fail('Admin bejelentkezés', e.message); adminPage = await browser.newPage(); }

  // 7. Admin panel tartalom
  try {
    const html = await adminPage.content();
    html.includes('Push értesítés') ? pass('Admin PWA szekció látható') : fail('Admin PWA szekció', 'Nem jelenik meg');
    html.includes('Kihívások') ? pass('Admin Kihívás szekció látható') : fail('Admin Kihívás szekció', 'Nem jelenik meg');
  } catch(e) { fail('Admin panel tartalom', e.message); }

  // 8. VAPID key API
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/push/vapid-key`);
    const json = await r.json();
    json.publicKey && json.publicKey.length > 20 ? pass('VAPID key API', json.publicKey.substring(0,20)+'...') : fail('VAPID key API', JSON.stringify(json));
    await p.close();
  } catch(e) { fail('VAPID key API', e.message); }

  // 9. Kihívások API
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/challenges`);
    const json = await r.json();
    Array.isArray(json) ? pass('Kihívások API', `${json.length} kihívás`) : fail('Kihívások API', JSON.stringify(json));
    await p.close();
  } catch(e) { fail('Kihívások API', e.message); }

  // 10. Admin: Kihívás létrehozás
  try {
    const r = await adminPage.evaluate(async () => {
      const res = await fetch('/api/admin/challenges/add', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: 'title=Teszt+kihívás&description=Hozz+barátokat&type=referral&goal=10&reward=Értékes+nyeremény&icon=🔗'
      });
      return res.json();
    });
    r.ok ? pass('Admin: Kihívás létrehozás') : fail('Admin: Kihívás létrehozás', JSON.stringify(r));
  } catch(e) { fail('Admin: Kihívás létrehozás', e.message); }

  // 11. Kihívás megjelenik a listában
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/challenges`);
    const json = await r.json();
    const found = json.find(c => c.title === 'Teszt kihívás');
    found ? pass('Kihívás megjelenik API-ban', found.title) : fail('Kihívás nem jelenik meg', JSON.stringify(json));
    await p.close();
  } catch(e) { fail('Kihívás API ellenőrzés', e.message); }

  // 12. Időpont naptár API
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/slots`);
    const json = await r.json();
    Array.isArray(json) ? pass('Időpont naptár API', `${json.length} slot`) : fail('Időpont naptár API');
    await p.close();
  } catch(e) { fail('Időpont naptár API', e.message); }

  // 13. Admin: Időpont hozzáadás
  try {
    const r = await adminPage.evaluate(async () => {
      const res = await fetch('/api/admin/slots/add', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: 'datetime=2026-04-01T14:00&label=Teszt időpont — április 1.'
      });
      return res.json();
    });
    r.ok ? pass('Admin: Időpont létrehozás') : fail('Admin: Időpont létrehozás', JSON.stringify(r));
  } catch(e) { fail('Admin: Időpont létrehozás', e.message); }

  // 14. Visszaszámlálás API
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/countdown`);
    const json = await r.json();
    typeof json === 'object' ? pass('Visszaszámlálás API') : fail('Visszaszámlálás API');
    await p.close();
  } catch(e) { fail('Visszaszámlálás API', e.message); }

  // 15. Admin: Visszaszámlálás beállítás
  try {
    const r = await adminPage.evaluate(async () => {
      const res = await fetch('/api/admin/countdown', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: 'label=Következő+szerviz+nap&until=2026-04-10T10:00:00'
      });
      return res.json();
    });
    r.ok ? pass('Admin: Visszaszámlálás beállítás') : fail('Admin: Visszaszámlálás', JSON.stringify(r));
  } catch(e) { fail('Admin: Visszaszámlálás', e.message); }

  // 16. SeeCity státusz
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/seecity/status`);
    const json = await r.json();
    typeof json.players === 'number' ? pass('SeeCity státusz', `${json.players} játékos online`) : fail('SeeCity státusz', JSON.stringify(json));
    await p.close();
  } catch(e) { fail('SeeCity státusz', e.message); }

  // 17. Rangsor API
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/leaderboard`);
    const json = await r.json();
    Array.isArray(json) ? pass('Rangsor API') : fail('Rangsor API');
    await p.close();
  } catch(e) { fail('Rangsor API', e.message); }

  // 18. Wheel oldal
  try {
    const p = await browser.newPage();
    await p.goto(`${BASE}/wheel.html`, { waitUntil: 'domcontentloaded' });
    pass('Wheel oldal betölt');
    await p.close();
  } catch(e) { fail('Wheel oldal', e.message); }

  // 19. Garázsnapló oldal redirect
  try {
    const p = await browser.newPage();
    await p.goto(`${BASE}/garage.html`);
    await p.waitForTimeout(2000);
    p.url().includes('login') ? pass('Garázsnapló auth redirect') : fail('Garázsnapló redirect', p.url());
    await p.close();
  } catch(e) { fail('Garázsnapló redirect', e.message); }

  // 20. Profil oldal redirect
  try {
    const p = await browser.newPage();
    await p.goto(`${BASE}/profile.html`);
    await p.waitForTimeout(2000);
    p.url().includes('login') ? pass('Profil auth redirect') : fail('Profil redirect', p.url());
    await p.close();
  } catch(e) { fail('Profil redirect', e.message); }

  // 21. Track API
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/track`);
    const json = await r.json();
    typeof json.total === 'number' ? pass('Track API', `${json.total} látogató`) : fail('Track API');
    await p.close();
  } catch(e) { fail('Track API', e.message); }

  // 22. Admin adatok összesítő
  try {
    const data = await adminPage.evaluate(async () => {
      const r = await fetch('/api/admin/data');
      return r.json();
    });
    Array.isArray(data.users) ? pass('Admin adatok', `${data.users.length} user, ${data.bookings.length} foglalás`) : fail('Admin adatok', 'hibás válasz');
  } catch(e) { fail('Admin adatok', e.message); }

  await adminPage.close();
  await browser.close();

  // ===== RIPORT KÉP =====
  const ok = results.filter(r=>r.ok).length;
  const total = results.length;
  const { chromium: cr } = require('@playwright/test');
  const rb = await cr.launch({ headless: true });
  const rp = await rb.newPage();
  await rp.setViewportSize({ width: 880, height: 200 + total * 50 });
  await rp.setContent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
body{font-family:'Segoe UI',sans-serif;background:#0a0a1a;color:#fff;padding:40px;margin:0}
h1{color:#f59e0b;margin-bottom:4px;font-size:22px}
.sub{color:#555;margin-bottom:22px;font-size:13px}
.stats{background:rgba(255,255,255,0.04);border-radius:10px;padding:16px 24px;margin-bottom:22px;display:flex;gap:36px;flex-wrap:wrap}
.stat .val{color:#f59e0b;font-size:26px;font-weight:700}
.stat .lbl{color:#666;font-size:12px;margin-top:2px}
.row{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:8px;margin-bottom:5px}
.row.ok{background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.22)}
.row.fail{background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.22)}
.icon{width:20px;font-size:14px}
.name{flex:1;font-size:13px;font-weight:500}
.detail{color:#555;font-size:11px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.footer{margin-top:22px;color:#333;font-size:11px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);padding-top:14px}
.badge{padding:5px 16px;border-radius:20px;font-size:13px;font-weight:700;display:inline-block;margin-bottom:20px}
.green{background:rgba(34,197,94,0.12);color:#4ade80;border:1px solid rgba(34,197,94,0.4)}
.red{background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.4)}
</style></head>
<body>
<h1>⚡ PowerPulse ECU — v4.0 Teljes Teszt</h1>
<p class='sub'>Generálva: ${new Date().toLocaleString('hu-HU')} · Playwright automatikus teszt</p>
<span class='badge ${ok===total?"green":"red"}'>${ok===total?`✅ MINDEN TESZT ÁTMENT — ${ok}/${total}`:`⚠️ ${ok}/${total} ÁTMENT`}</span>
<div class='stats'>
  <div class='stat'><div class='val'>${total}</div><div class='lbl'>Összes teszt</div></div>
  <div class='stat'><div class='val' style='color:#4ade80'>${ok}</div><div class='lbl'>✅ Átment</div></div>
  <div class='stat'><div class='val' style='color:${total-ok>0?"#f87171":"#4ade80"}'>${total-ok}</div><div class='lbl'>❌ Sikertelen</div></div>
  <div class='stat'><div class='val'>v4.0</div><div class='lbl'>PWA + Push + Kihívás</div></div>
</div>
${results.map(r=>`<div class='row ${r.ok?"ok":"fail"}'>
  <div class='icon'>${r.ok?"✅":"❌"}</div>
  <div class='name'>${r.name}</div>
  <div class='detail'>${r.detail||''}</div>
</div>`).join('')}
<p class='footer'>⚡ PowerPulse ECU · v4.0 · PWA · Push értesítés · Kihívások · SeeCity · commit 0dd6b96 · ${new Date().toLocaleDateString('hu-HU')}</p>
</body></html>`);
  await rp.screenshot({ path: '/root/.openclaw/workspace/v4_report.png', fullPage: true });
  await rb.close();
  console.log(`\n========= VÉGEREDMÉNY: ${ok}/${total} =========`);
  expect(ok).toBe(total);
});
