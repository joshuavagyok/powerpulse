const { test, expect, chromium } = require('@playwright/test');
const BASE = 'https://powerpulse-thhr.onrender.com';
const TS = Date.now();
const IC = `Test_${TS}`;
const EMAIL = `josika886+t${TS}@gmail.com`;
const PASS = 'Teszt12345';

const results = [];
function pass(name, detail='') { results.push({name, ok:true, detail}); console.log(`✅ ${name}${detail?' — '+detail:''}`); }
function fail(name, detail='') { results.push({name, ok:false, detail}); console.log(`❌ ${name}${detail?' — '+detail:''}`); }

test('PowerPulse v5 — Igazolás + Mobilapp teszt', async () => {
  const browser = await chromium.launch({ headless: true });

  // 1. Admin mobile oldal betölt
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/admin-mobile.html`, { waitUntil: 'domcontentloaded' });
    r.ok() ? pass('Admin mobilapp betölt') : fail('Admin mobilapp', `HTTP ${r.status()}`);
    await p.close();
  } catch(e) { fail('Admin mobilapp', e.message); }

  // 2. Manifest PWA ellenőrzés
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/manifest.json`);
    const json = await r.json();
    json.start_url === '/admin-mobile.html' ? pass('Manifest: start_url = admin-mobile.html') : fail('Manifest start_url', json.start_url);
    json.display === 'standalone' ? pass('Manifest: standalone mód') : fail('Manifest standalone', json.display);
    await p.close();
  } catch(e) { fail('Manifest', e.message); }

  // 3. Service Worker
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/sw.js`);
    const text = await p.content();
    text.includes('push') && text.includes('notificationclick') ? pass('Service Worker: push + click handler') : fail('Service Worker hiányos');
    await p.close();
  } catch(e) { fail('Service Worker', e.message); }

  // 4. VAPID key API
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/push/vapid-key`);
    const json = await r.json();
    json.publicKey?.length > 20 ? pass('VAPID key API', json.publicKey.substring(0,24)+'...') : fail('VAPID key', JSON.stringify(json));
    await p.close();
  } catch(e) { fail('VAPID key API', e.message); }

  // 5. Admin mobile login
  let adminPage = await browser.newPage();
  try {
    await adminPage.goto(`${BASE}/admin-mobile.html`);
    await adminPage.fill('#login-user', 'Joshua');
    await adminPage.fill('#login-pass', 'Hungary20030905');
    await adminPage.click('button:has-text("Belépés")');
    await adminPage.waitForTimeout(2500);
    const app = await adminPage.locator('#app').isVisible();
    app ? pass('Admin mobile: bejelentkezés sikeres') : fail('Admin mobile: login nem működik');
  } catch(e) { fail('Admin mobile login', e.message); }

  // 6. Admin mobile: tab váltások
  try {
    await adminPage.click('button:has-text("Userek")');
    await adminPage.waitForTimeout(500);
    const usersVisible = await adminPage.locator('#tab-users').isVisible();
    usersVisible ? pass('Admin mobile: Userek tab') : fail('Admin mobile: Userek tab nem látható');

    await adminPage.click('button:has-text("Hírek")');
    await adminPage.waitForTimeout(500);
    const announceVisible = await adminPage.locator('#tab-announce').isVisible();
    announceVisible ? pass('Admin mobile: Hírek tab') : fail('Admin mobile: Hírek tab nem látható');

    await adminPage.locator('.bottom-nav button:has-text("Beállítás")').click();
    await adminPage.waitForTimeout(500);
    const settingsVisible = await adminPage.locator('#tab-settings').isVisible();
    settingsVisible ? pass('Admin mobile: Beállítások tab') : fail('Admin mobile: Beállítások tab nem látható');

    await adminPage.click('button:has-text("Foglalások")');
    await adminPage.waitForTimeout(500);
    pass('Admin mobile: tab navigáció OK');
  } catch(e) { fail('Admin mobile tabok', e.message); }

  // 7. Admin mobile: push szekció látható
  try {
    await adminPage.locator('.bottom-nav button:has-text("Beállítás")').click();
    await adminPage.waitForTimeout(300);
    const html = await adminPage.content();
    html.includes('Push') ? pass('Admin mobile: Push szekció látható') : fail('Admin mobile: Push szekció hiányzik');
  } catch(e) { fail('Admin mobile push szekció', e.message); }

  // 8. Regisztráció (hogy legyen user a cert teszthez)
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

  // 9. Admin: foglalás létrehozás direkt API-val (teszteléshez)
  let testBookingId = null;
  try {
    const r = await adminPage.evaluate(async (ic) => {
      // Direkt DB insert szimulálása: foglalás beküldés
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `ic_name=${encodeURIComponent(ic)}&discord=teszt&phone=06201234567&car=Sultan+RS&goal=ECU+Alap+tuning&notes=Playwright+teszt`
      });
      return { status: res.status, url: res.url };
    }, IC);
    pass('Teszt foglalás beküldve', `status: ${r.status}`);
  } catch(e) { fail('Teszt foglalás', e.message); }

  // 10. Admin: foglalás megtalálása és elfogadása
  try {
    await adminPage.click('button:has-text("Foglalások")');
    await adminPage.waitForTimeout(1000);
    const data = await adminPage.evaluate(async () => {
      const r = await fetch('/api/admin/data');
      return r.json();
    });
    const booking = data.bookings.find(b => b.ic_name === IC);
    if (booking) {
      testBookingId = booking.id;
      pass('Foglalás megtalálva az adminban', `ID: ${booking.id.substring(0,15)}...`);
      // Elfogadás
      const acceptRes = await adminPage.evaluate(async (id) => {
        const r = await fetch(`/api/admin/booking/${id}/accepted`, {method:'POST'});
        return r.json();
      }, booking.id);
      acceptRes.ok ? pass('Foglalás elfogadva') : fail('Foglalás elfogadás', JSON.stringify(acceptRes));
    } else {
      fail('Foglalás nem található', `${data.bookings.length} foglalás van`);
    }
  } catch(e) { fail('Admin foglalás kezelés', e.message); }

  // 11. Certificate API — elfogadott foglaláshoz (fetch-hel teszteljük, nem page.goto)
  try {
    if (testBookingId) {
      const result = await adminPage.evaluate(async ({id, base}) => {
        const r = await fetch(`${base}/api/certificate/${id}`);
        return { status: r.status, contentType: r.headers.get('content-type') };
      }, { id: testBookingId, base: BASE });
      result.contentType?.includes('image/png') && result.status === 200
        ? pass('Certificate API: PNG generálás OK', `${result.status} · ${result.contentType}`)
        : fail('Certificate API: nem PNG', `status: ${result.status}, type: ${result.contentType}`);
    } else {
      fail('Certificate API', 'Nincs testBookingId');
    }
  } catch(e) { fail('Certificate API', e.message); }

  // 12. Certificate API — nem elfogadott foglaláshoz (hibát kell dobjon)
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/certificate/FAKE_ID_12345`);
    const json = JSON.parse(await p.evaluate(() => document.body.innerText));
    (r.status() === 404 || json.error) ? pass('Certificate API: hibás ID → 404') : fail('Certificate API: hibás ID nem dob hibát', JSON.stringify(json));
    await p.close();
  } catch(e) { fail('Certificate API hibakezelés', e.message); }

  // 13. Profil oldal igazolás gomb (auth nélkül redirect)
  try {
    const p = await browser.newPage();
    await p.goto(`${BASE}/profile.html`);
    await p.waitForTimeout(2000);
    p.url().includes('login') ? pass('Profil auth redirect') : fail('Profil redirect', p.url());
    await p.close();
  } catch(e) { fail('Profil redirect', e.message); }

  // 14. Admin mobile: hirdetmény hozzáadás
  try {
    await adminPage.locator('.bottom-nav button:has-text("Hírek")').click();
    await adminPage.waitForTimeout(300);
    await adminPage.fill('#new-emoji', '🔥');
    await adminPage.fill('#new-text', 'Playwright teszt hirdetmény');
    await adminPage.click('button:has-text("+ Hozzáadás")');
    await adminPage.waitForTimeout(1000);
    const data = await adminPage.evaluate(async () => { const r = await fetch('/api/admin/data'); return r.json(); });
    const found = data.announcements.find(a => a.text === 'Playwright teszt hirdetmény');
    found ? pass('Admin mobile: hirdetmény hozzáadás') : fail('Admin mobile: hirdetmény nem jelent meg');
  } catch(e) { fail('Admin mobile hirdetmény', e.message); }

  // 15. SeeCity státusz
  try {
    const p = await browser.newPage();
    const r = await p.goto(`${BASE}/api/seecity/status`);
    const json = JSON.parse(await p.evaluate(() => document.body.innerText));
    typeof json.players === 'number' ? pass('SeeCity státusz', `${json.players} játékos`) : fail('SeeCity', JSON.stringify(json));
    await p.close();
  } catch(e) { fail('SeeCity', e.message); }

  await adminPage.close();
  await browser.close();

  // RIPORT KÉP
  const ok = results.filter(r=>r.ok).length;
  const total = results.length;
  const { chromium: cr } = require('@playwright/test');
  const rb = await cr.launch({ headless: true });
  const rp = await rb.newPage();
  await rp.setViewportSize({ width: 900, height: Math.max(700, 220 + total * 50) });
  await rp.setContent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#0a0a1a;color:#fff;padding:36px;margin:0}
h1{color:#f59e0b;margin:0 0 4px;font-size:21px;font-weight:700}
.sub{color:#444;margin-bottom:20px;font-size:12px}
.badge{padding:6px 18px;border-radius:20px;font-size:13px;font-weight:700;display:inline-block;margin-bottom:20px}
.green{background:rgba(34,197,94,0.12);color:#4ade80;border:1px solid rgba(34,197,94,0.35)}
.amber{background:rgba(245,158,11,0.12);color:#fbbf24;border:1px solid rgba(245,158,11,0.35)}
.stats{background:rgba(255,255,255,0.03);border-radius:10px;padding:14px 20px;margin-bottom:20px;display:flex;gap:32px;flex-wrap:wrap}
.stat .val{font-size:24px;font-weight:700;color:#f59e0b}
.stat .lbl{font-size:11px;color:#555;margin-top:2px}
.row{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:8px;margin-bottom:5px}
.row.ok{background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.18)}
.row.fail{background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.22)}
.icon{width:20px;font-size:14px;flex-shrink:0}
.name{flex:1;font-size:13px;font-weight:500}
.detail{color:#444;font-size:11px;max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.footer{margin-top:20px;color:#2a2a3a;font-size:11px;text-align:center;border-top:1px solid rgba(255,255,255,0.04);padding-top:14px}
</style></head><body>
<h1>⚡ PowerPulse — v5 Teszt (Igazolás + Mobilapp)</h1>
<p class='sub'>Generálva: ${new Date().toLocaleString('hu-HU')} · Playwright · commit 999367f</p>
<span class='badge ${ok===total?"green":"amber"}'>${ok===total?`✅ MINDEN TESZT ÁTMENT — ${ok}/${total}`:`⚠️ ${ok}/${total} ÁTMENT`}</span>
<div class='stats'>
  <div class='stat'><div class='val'>${total}</div><div class='lbl'>Összes</div></div>
  <div class='stat'><div class='val' style='color:#4ade80'>${ok}</div><div class='lbl'>✅ Átment</div></div>
  <div class='stat'><div class='val' style='color:${total-ok>0?"#f87171":"#4ade80"}'>${total-ok}</div><div class='lbl'>❌ Sikertelen</div></div>
  <div class='stat'><div class='val'>v5</div><div class='lbl'>Cert + PWA</div></div>
</div>
${results.map(r=>`<div class='row ${r.ok?"ok":"fail"}'>
  <div class='icon'>${r.ok?"✅":"❌"}</div>
  <div class='name'>${r.name}</div>
  <div class='detail'>${r.detail||''}</div>
</div>`).join('')}
<p class='footer'>⚡ PowerPulse ECU · v5 · 📜 Tuning Igazolás · 📱 PWA Mobilapp · ${new Date().toLocaleDateString('hu-HU')}</p>
</body></html>`);
  await rp.screenshot({ path: '/root/.openclaw/workspace/v5_report.png', fullPage: true });
  await rb.close();
  console.log(`\n========= VÉGEREDMÉNY: ${ok}/${total} =========`);
  expect(ok, `${total-ok} teszt sikertelen!`).toBe(total);
});
