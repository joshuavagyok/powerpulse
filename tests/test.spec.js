const { test, expect } = require('@playwright/test');

const BASE = 'https://powerpulse-thhr.onrender.com';
const TS = Date.now();
const IC = `TestUser${TS}`;
const EMAIL = `josika886+pw${TS}@gmail.com`;
const PASS = 'teszt12345';

test('1. Főoldal betölt', async ({ page }) => {
  await page.goto(BASE);
  await expect(page).toHaveTitle(/PowerPulse/i);
  console.log('✅ Főoldal OK');
});

test('2. Login oldal betölt', async ({ page }) => {
  await page.goto(`${BASE}/login.html`);
  await expect(page.locator('h1')).toContainText('PowerPulse');
  console.log('✅ Login oldal OK');
});

test('3. Regisztráció', async ({ page }) => {
  await page.goto(`${BASE}/login.html`);
  await page.click('text=Regisztráció');
  await page.fill('#reg-ic', IC);
  await page.fill('#reg-discord', 'teszt_discord');
  await page.fill('#reg-email', EMAIL);
  await page.fill('#reg-pass', PASS);
  await page.fill('#reg-pass2', PASS);
  await page.click('#register-form .btn');
  await page.waitForTimeout(3000);
  const msg = await page.locator('#register-msg').textContent();
  console.log('Regisztráció válasz:', msg);
  expect(msg).toContain('sikeres');
});

test('4. Bejelentkezés (nem megerősített fiók)', async ({ page }) => {
  await page.goto(`${BASE}/login.html`);
  await page.fill('#login-ic', IC);
  await page.fill('#login-pass', PASS);
  await page.click('#login-form .btn');
  await page.waitForTimeout(2000);
  const msg = await page.locator('#login-msg').textContent();
  console.log('Login válasz:', msg);
  expect(msg).toContain('email');
});

test('5. Admin panel betölt', async ({ page }) => {
  await page.goto(`${BASE}/admin.html`);
  await expect(page.locator('body')).toBeVisible();
  console.log('✅ Admin panel OK');
});

test('6. Admin bejelentkezés', async ({ page }) => {
  await page.goto(`${BASE}/admin.html`);
  await page.fill('#login-user', 'Joshua');
  await page.fill('#login-pass', 'Hungary20030905');
  await page.click('button:has-text("Belépés")');
  await page.waitForTimeout(2000);
  const url = page.url();
  console.log('Admin URL:', url);
});

test('7. Wheel oldal betölt', async ({ page }) => {
  await page.goto(`${BASE}/wheel.html`);
  await expect(page.locator('body')).toBeVisible();
  console.log('✅ Wheel oldal OK');
});

test('8. API - track', async ({ request }) => {
  const r = await request.get(`${BASE}/api/track`);
  const data = await r.json();
  console.log('Track:', data);
  expect(data.total).toBeGreaterThanOrEqual(0);
});

test('9. API - hirdetmények', async ({ request }) => {
  const r = await request.get(`${BASE}/api/announcements`);
  expect(r.ok()).toBeTruthy();
  console.log('✅ Announcements API OK');
});

test('10. API - vélemények', async ({ request }) => {
  const r = await request.get(`${BASE}/api/reviews`);
  expect(r.ok()).toBeTruthy();
  console.log('✅ Reviews API OK');
});

test('11. API - rangsor', async ({ request }) => {
  const r = await request.get(`${BASE}/api/leaderboard`);
  expect(r.ok()).toBeTruthy();
  console.log('✅ Leaderboard API OK');
});

test('12. Profil oldal (nem bejelentkezett)', async ({ page }) => {
  await page.goto(`${BASE}/profile.html`);
  await page.waitForTimeout(2000);
  // Ha nincs bejelentkezve, átirányít
  const url = page.url();
  console.log('Profil URL (nem auth):', url);
});
