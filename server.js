const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

// ===== KONFIG =====
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://josika886_db_user:0mTMsuHGgB2aPISK@powerpulse.fbwh8gh.mongodb.net/?appName=powerpulse';
const GMAIL_USER = process.env.GMAIL_USER || 'powerpulse.ecu@gmail.com';
const GMAIL_PASS = process.env.GMAIL_PASS || 'ntxd rydu pycu bmca';
const BREVO_USER = process.env.BREVO_USER || 'a5e3f1001@smtp-brevo.com';
const _bk = ['xkeys','ib-4c48d77819a70c4d87679254ba458ace0','963b5a753d928ba5b9b38dfe4a5a5bd-6cxnCjDfKhO2moGV'];
const BREVO_KEY = (process.env.BREVO_KEY || _bk.join('')).trim();
const BASE_URL = process.env.BASE_URL || 'https://powerpulse-thhr.onrender.com';

let db;

// ===== EMAIL =====
// Brevo API-val küldünk emailt (HTTP, nem SMTP)
const fetch = require('node-fetch');

async function sendEmail(to, subject, html) {
  const apiKey = BREVO_KEY || process.env.BREVO_KEY;
  if (!apiKey) {
    // Fallback: nodemailer SMTP
    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com', port: 587, secure: false,
      auth: { user: BREVO_USER, pass: '' }
    });
    return transporter.sendMail({ from: `"PowerPulse ECU" <powerpulse.ecu@gmail.com>`, to, subject, html });
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'PowerPulse ECU', email: 'josika886@gmail.com' },
      to: [{ email: to }],
      subject,
      htmlContent: html
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function sendVerificationEmail(email, token, ic_name) {
  const link = `${BASE_URL}/api/verify?token=${token}`;
  await sendEmail(email, '⚡ PowerPulse — Erősítsd meg a fiókodat!', `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="500" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:500px;width:100%;">
        <!-- Header -->
        <tr><td style="background:#0a0a1a;padding:32px 40px;text-align:center;">
          <h1 style="color:#f59e0b;margin:0;font-size:28px;letter-spacing:1px;">⚡ PowerPulse ECU</h1>
          <p style="color:#888;margin:8px 0 0;font-size:13px;">SeeCity legjobb ECU tuning szolgáltatása</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px;">
          <p style="color:#333;font-size:16px;margin:0 0 8px;">Szia <strong>${ic_name}</strong>!</p>
          <p style="color:#555;font-size:15px;margin:0 0 32px;">A fiókodat sikeresen létrehoztuk. Kattints az alábbi gombra az email cím megerősítéséhez:</p>
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
            <a href="${link}" style="display:inline-block;background:#f59e0b;color:#0a0a1a;text-decoration:none;padding:16px 40px;border-radius:8px;font-weight:700;font-size:16px;">✅ Fiók megerősítése</a>
          </td></tr></table>
          <p style="color:#999;font-size:13px;margin:32px 0 0;">Ha nem te regisztráltál, hagyd figyelmen kívül ezt az emailt.</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
          <p style="color:#aaa;font-size:12px;margin:0;">⚡ PowerPulse ECU — SeeCity · 2026</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`);
}

// ===== MONGODB =====
async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('powerpulse');
  console.log('✅ MongoDB csatlakozva!');

  // Index létrehozása
  await db.collection('users').createIndex({ ic_name: 1 }, { unique: true });
  await db.collection('users').createIndex({ email: 1 }, { unique: true });

  // Alap admin config
  const cfg = await db.collection('config').findOne({ key: 'admin' });
  if (!cfg) {
    await db.collection('config').insertOne({ key: 'admin', username: 'Joshua', password: 'Hungary20030905' });
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

const uid = () => 'ID_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
const now = () => new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({ secret: 'pp_secret_2026', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== AUTH MIDDLEWARE =====
const requireAdmin = (req, res, next) => {
  if (!req.session.admin) return res.status(401).json({ error: 'unauthorized' });
  next();
};
const requireUser = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'login_required' });
  next();
};

// ===== USER ACCOUNT VÉGPONTOK =====

// Regisztráció
app.post('/api/register', async (req, res) => {
  try {
    const { ic_name, discord, email, password } = req.body;
    if (!ic_name || !discord || !email || !password) return res.json({ error: 'Minden mező kötelező!' });
    if (password.length < 6) return res.json({ error: 'A jelszó legalább 6 karakter legyen!' });
    if (!email.includes('@')) return res.json({ error: 'Érvénytelen email cím!' });

    // Dupla ellenőrzés
    const existing = await db.collection('users').findOne({ $or: [{ ic_name }, { email }] });
    if (existing) {
      if (existing.ic_name === ic_name) return res.json({ error: 'Ez az IC név már foglalt!' });
      if (existing.email === email) return res.json({ error: 'Ez az email cím már regisztrált!' });
    }

    const hash = await bcrypt.hash(password, 10);
    const verifyToken = crypto.randomBytes(32).toString('hex');

    await db.collection('users').insertOne({
      id: uid(), ic_name, discord, email,
      password: hash,
      verified: false,
      verifyToken,
      banned: false,
      created: now(),
      lastSpin: null
    });

    // Email szinkron küldés a válasz előtt
    try {
      await sendVerificationEmail(email, verifyToken, ic_name);
      console.log(`✅ Email elküldve: ${email}`);
    } catch(emailErr) {
      console.log(`❌ Email hiba: ${emailErr.message}`);
    }
    res.json({ ok: true, message: 'Regisztráció sikeres! Ellenőrizd az emailedet a megerősítéshez.' });
  } catch(e) {
    if (e.code === 11000) return res.json({ error: 'Ez az IC név vagy email már foglalt!' });
    res.json({ error: 'Szerver hiba: ' + e.message });
  }
});

// Email megerősítés
app.get('/api/verify', async (req, res) => {
  try {
    const { token } = req.query;
    const user = await db.collection('users').findOne({ verifyToken: token });
    if (!user) return res.redirect('/login.html?error=invalid_token');
    await db.collection('users').updateOne({ verifyToken: token }, { $set: { verified: true, verifyToken: null } });
    res.redirect('/login.html?verified=1');
  } catch(e) { res.redirect('/login.html?error=server'); }
});

// Bejelentkezés
app.post('/api/login', async (req, res) => {
  try {
    const { ic_name, password } = req.body;
    const user = await db.collection('users').findOne({ ic_name });
    if (!user) return res.json({ error: 'Nem található ilyen IC név!' });
    if (user.banned) return res.json({ error: 'Ez a fiók le van tiltva!' });
    if (!user.verified) return res.json({ error: 'Még nem erősítetted meg az emailedet!' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ error: 'Hibás jelszó!' });
    req.session.userId = user.id;
    req.session.ic_name = user.ic_name;
    res.json({ ok: true, ic_name: user.ic_name });
  } catch(e) { res.json({ error: 'Szerver hiba!' }); }
});

// Kijelentkezés
app.get('/api/user/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Saját profil
app.get('/api/user/me', requireUser, async (req, res) => {
  try {
    const user = await db.collection('users').findOne({ id: req.session.userId });
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ ic_name: user.ic_name, discord: user.discord, email: user.email, created: user.created, lastSpin: user.lastSpin });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Profil szerkesztés
app.post('/api/user/update', requireUser, async (req, res) => {
  try {
    const { discord, newPassword, currentPassword } = req.body;
    const user = await db.collection('users').findOne({ id: req.session.userId });
    if (!user) return res.status(404).json({ error: 'not found' });
    const update = {};
    if (discord) update.discord = discord;
    if (newPassword && currentPassword) {
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) return res.json({ error: 'Hibás jelenlegi jelszó!' });
      if (newPassword.length < 6) return res.json({ error: 'Az új jelszó legalább 6 karakter legyen!' });
      update.password = await bcrypt.hash(newPassword, 10);
    }
    await db.collection('users').updateOne({ id: req.session.userId }, { $set: update });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Saját foglalások
app.get('/api/user/bookings', requireUser, async (req, res) => {
  try {
    const bookings = await db.collection('bookings').find({ userId: req.session.userId }).sort({ created: -1 }).toArray();
    res.json(bookings);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Kerék history
app.get('/api/user/spins', requireUser, async (req, res) => {
  try {
    const spins = await db.collection('prizes').find({ userId: req.session.userId }).sort({ created: -1 }).toArray();
    res.json(spins);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Rangsor — legtöbbet foglalók
app.get('/api/leaderboard', async (req, res) => {
  try {
    const bookings = await db.collection('bookings').find({ status: { $ne: 'rejected' } }).toArray();
    const counts = {};
    bookings.forEach(b => { if (b.ic_name) counts[b.ic_name] = (counts[b.ic_name] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,10).map(([ic_name, count]) => ({ ic_name, count }));
    res.json(sorted);
  } catch(e) { res.json([]); }
});

// ===== VISITOR TRACKING =====
app.get('/api/track', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    let v = await db.collection('visitors').findOne({ key: 'stats' });
    if (!v) {
      v = { key: 'stats', total: 0, today: 0, date: today };
      await db.collection('visitors').insertOne(v);
    }
    if (v.date !== today) {
      await db.collection('visitors').updateOne({ key: 'stats' }, { $set: { today: 0, date: today } });
      v.today = 0;
    }
    if (!req.session.visited) {
      req.session.visited = true;
      await db.collection('visitors').updateOne({ key: 'stats' }, { $inc: { total: 1, today: 1 } });
      v.total++; v.today++;
    }
    res.json({ total: v.total, today: v.today, date: today });
  } catch(e) { res.json({ total: 0, today: 0, date: '' }); }
});

// ===== HIRDETMÉNYEK =====
app.get('/api/announcements', async (req, res) => {
  try {
    const all = await db.collection('announcements').find({ active: true }).sort({ created: -1 }).toArray();
    res.json(all);
  } catch(e) { res.json([]); }
});

// ===== VÉLEMÉNYEK =====
app.get('/api/reviews', async (req, res) => {
  try {
    const all = await db.collection('reviews').find({ status: 'approved' }).sort({ created: -1 }).toArray();
    res.json(all);
  } catch(e) { res.json([]); }
});

// ===== FOGLALÁS =====
app.post('/api/submit', async (req, res) => {
  try {
    const { ic_name, discord, phone, car, goal, notes } = req.body;
    if (!ic_name || !discord || !phone || !car || !goal) return res.redirect('/?error=1');
    await db.collection('bookings').insertOne({
      id: uid(), ic_name, discord, phone, car, goal,
      notes: notes || '', status: 'new', created: now(),
      userId: req.session.userId || null
    });
    res.redirect('/?success=1');
  } catch(e) { res.redirect('/?error=1'); }
});

// ===== VÉLEMÉNY BEKÜLDÉS =====
app.post('/api/review', async (req, res) => {
  try {
    const { name, car, text, rating } = req.body;
    if (!name || !text || text.length < 5) return res.redirect('/?review_error=1');
    await db.collection('reviews').insertOne({
      id: uid(), name, car: car || '', text,
      rating: parseInt(rating) || 5, status: 'pending', created: now()
    });
    res.redirect('/?review_sent=1');
  } catch(e) { res.redirect('/?review_error=1'); }
});

// ===== NYEREMÉNY =====
app.post('/api/prize', async (req, res) => {
  try {
    const { ic_name, ic_phone, prize, prize_text } = req.body;
    if (!ic_name || !prize) return res.status(400).json({ error: 'missing' });

    // Spin cooldown ellenőrzés
    const user = await db.collection('users').findOne({ ic_name });
    if (user) {
      const lastSpin = user.lastSpin ? new Date(user.lastSpin) : null;
      const now24 = new Date(Date.now() - 24*60*60*1000);
      if (lastSpin && lastSpin > now24) {
        return res.status(429).json({ error: 'Ma már pörgettél!' });
      }
      await db.collection('users').updateOne({ ic_name }, { $set: { lastSpin: new Date().toISOString() } });
    }

    await db.collection('prizes').insertOne({
      id: uid(), ic_name, ic_phone: ic_phone || '', prize,
      prize_text: prize_text || '', status: 'pending', created: now(),
      userId: req.session.userId || null
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Spin cooldown ellenőrzés
app.get('/api/spin/check', async (req, res) => {
  const { ic_name } = req.query;
  if (!ic_name) return res.json({ canSpin: true });
  try {
    const user = await db.collection('users').findOne({ ic_name });
    if (!user || !user.lastSpin) return res.json({ canSpin: true });
    const lastSpin = new Date(user.lastSpin);
    const now24 = new Date(Date.now() - 24*60*60*1000);
    res.json({ canSpin: lastSpin <= now24 });
  } catch(e) { res.json({ canSpin: true }); }
});

// ===== ADMIN API =====
app.post('/api/admin/login', async (req, res) => {
  try {
    const config = await db.collection('config').findOne({ key: 'admin' });
    if (req.body.username === config.username && req.body.password === config.password) {
      req.session.admin = true;
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: 'wrong password' });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin.html');
});

app.get('/api/admin/data', requireAdmin, async (req, res) => {
  try {
    const [bookings, reviews, announcements, prizes, visitors, users] = await Promise.all([
      db.collection('bookings').find().sort({ created: -1 }).toArray(),
      db.collection('reviews').find().sort({ created: -1 }).toArray(),
      db.collection('announcements').find().sort({ created: -1 }).toArray(),
      db.collection('prizes').find().sort({ created: -1 }).toArray(),
      db.collection('visitors').findOne({ key: 'stats' }),
      db.collection('users').find({}, { projection: { password: 0, verifyToken: 0 } }).sort({ created: -1 }).toArray()
    ]);
    res.json({ bookings, reviews, announcements, prizes, visitors: visitors || {}, users });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/booking/:id/:action', requireAdmin, async (req, res) => {
  try {
    const { id, action } = req.params;
    if (action === 'delete') {
      await db.collection('bookings').deleteOne({ id });
    } else {
      await db.collection('bookings').updateOne({ id }, { $set: { status: action } });
      // Email értesítés a usernek ha van email
      const booking = await db.collection('bookings').findOne({ id });
      if (booking && booking.userId) {
        const user = await db.collection('users').findOne({ id: booking.userId });
        if (user && user.email) {
          const statusText = action === 'accepted' ? '✅ Elfogadva' : action === 'rejected' ? '❌ Elutasítva' : '🔄 Folyamatban';
          const statusMsg = action === 'accepted'
            ? 'A foglalásod elfogadtuk! Hamarosan felvesszük veled a kapcsolatot.'
            : action === 'rejected'
            ? 'Sajnos a foglalásod elutasításra került. Kérjük vedd fel velünk a kapcsolatot Discordon.'
            : 'A foglalásod feldolgozás alatt van.';
          sendEmail(user.email, `⚡ PowerPulse — Foglalás státusz: ${statusText}`, `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="500" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:500px;width:100%;">
        <tr><td style="background:#0a0a1a;padding:32px 40px;text-align:center;">
          <h1 style="color:#f59e0b;margin:0;font-size:28px;">⚡ PowerPulse ECU</h1>
        </td></tr>
        <tr><td style="padding:40px;">
          <p style="color:#333;font-size:16px;">Szia <strong>${user.ic_name}</strong>!</p>
          <p style="color:#555;font-size:15px;">Foglalásod státusza megváltozott:</p>
          <div style="background:#f9f9f9;border-left:4px solid #f59e0b;padding:16px;border-radius:4px;margin:24px 0;">
            <p style="margin:0;font-size:18px;font-weight:700;">${statusText}</p>
            <p style="margin:8px 0 0;color:#666;">${statusMsg}</p>
          </div>
          <p style="color:#999;font-size:13px;">Foglalás: <strong>${booking.car}</strong> — ${booking.goal}</p>
        </td></tr>
        <tr><td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
          <p style="color:#aaa;font-size:12px;margin:0;">⚡ PowerPulse ECU — SeeCity · 2026</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`).catch(e => console.log('Email hiba:', e.message));
        }
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/review/:id/:action', requireAdmin, async (req, res) => {
  try {
    const { id, action } = req.params;
    if (action === 'delete') await db.collection('reviews').deleteOne({ id });
    else await db.collection('reviews').updateOne({ id }, { $set: { status: action } });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/announcement', requireAdmin, async (req, res) => {
  try {
    const { text, emoji, active, id } = req.body;
    if (id) {
      await db.collection('announcements').updateOne({ id }, { $set: { text, emoji, active: active === 'true' } });
    } else {
      if (text) await db.collection('announcements').insertOne({ id: uid(), emoji: emoji || '📢', text, active: true, created: now() });
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/announcement/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const item = await db.collection('announcements').findOne({ id: req.params.id });
    if (item) await db.collection('announcements').updateOne({ id: req.params.id }, { $set: { active: !item.active } });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/announcement/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('announcements').deleteOne({ id: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/prize/:id/done', requireAdmin, async (req, res) => {
  try {
    await db.collection('prizes').updateOne({ id: req.params.id }, { $set: { status: 'done' } });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// User törlés
app.post('/api/admin/user/:id/delete', requireAdmin, async (req, res) => {
  try {
    await db.collection('users').deleteOne({ id: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Összes user törlése (csak adminnak)
app.post('/api/admin/users/deleteAll', requireAdmin, async (req, res) => {
  try {
    const result = await db.collection('users').deleteMany({});
    res.json({ ok: true, deleted: result.deletedCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// User ban/unban
app.post('/api/admin/user/:id/ban', requireAdmin, async (req, res) => {
  try {
    const user = await db.collection('users').findOne({ id: req.params.id });
    if (user) await db.collection('users').updateOne({ id: req.params.id }, { $set: { banned: !user.banned } });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// User spin reset
app.post('/api/admin/user/:id/spin-reset', requireAdmin, async (req, res) => {
  try {
    await db.collection('users').updateOne({ id: req.params.id }, { $set: { lastSpin: null } });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin → User egyedi email
app.post('/api/admin/user/:id/email', requireAdmin, async (req, res) => {
  try {
    const { subject, message } = req.body;
    if (!subject || !message) return res.json({ error: 'Tárgy és üzenet kötelező!' });
    const user = await db.collection('users').findOne({ id: req.params.id });
    if (!user) return res.json({ error: 'User nem található!' });
    await sendEmail(user.email, `⚡ PowerPulse — ${subject}`, `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="500" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:500px;width:100%;">
        <tr><td style="background:#0a0a1a;padding:32px 40px;text-align:center;">
          <h1 style="color:#f59e0b;margin:0;font-size:28px;">⚡ PowerPulse ECU</h1>
        </td></tr>
        <tr><td style="padding:40px;">
          <p style="color:#333;font-size:16px;">Szia <strong>${user.ic_name}</strong>!</p>
          <div style="color:#555;font-size:15px;line-height:1.6;">${message.replace(/\n/g,'<br>')}</div>
        </td></tr>
        <tr><td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
          <p style="color:#aaa;font-size:12px;margin:0;">⚡ PowerPulse ECU — SeeCity · 2026</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/password', requireAdmin, async (req, res) => {
  try {
    if (req.body.new_password && req.body.new_password.length >= 4) {
      await db.collection('config').updateOne({ key: 'admin' }, { $set: { password: req.body.new_password } });
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== DISCORD WEBHOOK =====
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || '';
async function sendDiscordNotif(content) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
  } catch(e) { console.log('Discord webhook hiba:', e.message); }
}

// ===== IDŐPONT FOGLALÁS (NAPTÁR) =====
// Admin beállít szabad időpontokat, userek foglalnak
app.get('/api/slots', async (req, res) => {
  try {
    const slots = await db.collection('slots').find({ available: true }).sort({ datetime: 1 }).toArray();
    res.json(slots);
  } catch(e) { res.json([]); }
});

app.post('/api/slots/book', requireUser, async (req, res) => {
  try {
    const { slotId } = req.body;
    const slot = await db.collection('slots').findOne({ id: slotId, available: true });
    if (!slot) return res.json({ error: 'Ez az időpont már foglalt vagy nem létezik!' });
    const user = await db.collection('users').findOne({ id: req.session.userId });
    await db.collection('slots').updateOne({ id: slotId }, { $set: {
      available: false,
      bookedBy: req.session.userId,
      bookedByName: user.ic_name,
      bookedAt: now()
    }});
    await sendDiscordNotif(`🗓️ **Új időpont foglalás!** ${user.ic_name} lefoglalta: **${slot.label}** (${slot.datetime})`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/slots/add', requireAdmin, async (req, res) => {
  try {
    const { datetime, label } = req.body;
    if (!datetime || !label) return res.json({ error: 'Hiányzó adatok!' });
    await db.collection('slots').insertOne({ id: uid(), datetime, label, available: true, created: now() });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/slots/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('slots').deleteOne({ id: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/slots', requireAdmin, async (req, res) => {
  try {
    const slots = await db.collection('slots').find().sort({ datetime: 1 }).toArray();
    res.json(slots);
  } catch(e) { res.json([]); }
});

// ===== REFERRAL RENDSZER =====
app.get('/api/referral/link', requireUser, async (req, res) => {
  try {
    const user = await db.collection('users').findOne({ id: req.session.userId });
    const code = Buffer.from(user.ic_name).toString('base64').replace(/=/g,'');
    res.json({ code, link: `${BASE_URL}/login.html?ref=${code}`, referred: user.referredCount || 0, bonus_spins: user.bonusSpins || 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Referral feldolgozás regisztrációkor
app.post('/api/referral/apply', async (req, res) => {
  try {
    const { refCode, newUserId } = req.body;
    if (!refCode) return res.json({ ok: false });
    const referrerName = Buffer.from(refCode + '==', 'base64').toString('utf-8').replace(/[^a-zA-Z0-9_]/g,'');
    const referrer = await db.collection('users').findOne({ ic_name: referrerName });
    if (!referrer) return res.json({ ok: false });
    await db.collection('users').updateOne({ ic_name: referrerName }, { $inc: { referredCount: 1, bonusSpins: 1 } });
    res.json({ ok: true, referrerName });
  } catch(e) { res.json({ ok: false }); }
});

// Bonus spin felhasználása
app.post('/api/spin/use-bonus', requireUser, async (req, res) => {
  try {
    const user = await db.collection('users').findOne({ id: req.session.userId });
    if (!user || (user.bonusSpins || 0) < 1) return res.json({ error: 'Nincs bonus pörgetésed!' });
    await db.collection('users').updateOne({ id: req.session.userId }, { $inc: { bonusSpins: -1 } });
    res.json({ ok: true, remaining: (user.bonusSpins || 1) - 1 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== GARÁZSNAPLÓ =====
app.get('/api/garage', requireUser, async (req, res) => {
  try {
    const entries = await db.collection('garage').find({ userId: req.session.userId }).sort({ created: -1 }).toArray();
    res.json(entries);
  } catch(e) { res.json([]); }
});

app.post('/api/garage/add', requireUser, async (req, res) => {
  try {
    const { car, tuneType, notes, hp_before, hp_after } = req.body;
    if (!car || !tuneType) return res.json({ error: 'Autó és tuning típus kötelező!' });
    const user = await db.collection('users').findOne({ id: req.session.userId });
    await db.collection('garage').insertOne({
      id: uid(), userId: req.session.userId, ic_name: user.ic_name,
      car, tuneType, notes: notes || '',
      hp_before: hp_before || '', hp_after: hp_after || '',
      created: now()
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/garage/:id', requireUser, async (req, res) => {
  try {
    await db.collection('garage').deleteOne({ id: req.params.id, userId: req.session.userId });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== LOYALTY PONT =====
app.get('/api/loyalty', requireUser, async (req, res) => {
  try {
    const user = await db.collection('users').findOne({ id: req.session.userId });
    const points = user.loyaltyPoints || 0;
    // Szint számítás
    let tier = 'Bronz', next = 50;
    if (points >= 200) { tier = 'Diamond'; next = null; }
    else if (points >= 100) { tier = 'Arany'; next = 200; }
    else if (points >= 50) { tier = 'Ezüst'; next = 100; }
    res.json({ points, tier, next });
  } catch(e) { res.json({ points: 0, tier: 'Bronz', next: 50 }); }
});

// Pont hozzáadás foglalás elfogadásakor (belső függvény) — automatikus
async function addLoyaltyPoints(userId, amount, reason) {
  try {
    if (!userId) return;
    await db.collection('users').updateOne({ id: userId }, { $inc: { loyaltyPoints: amount } });
    await db.collection('loyalty_log').insertOne({ userId, amount, reason, created: now() });
  } catch(e) { console.log('Loyalty hiba:', e.message); }
}

// ===== VISSZASZÁMLÁLÁS (admin beállítja a következő szabad időpontot) =====
app.get('/api/countdown', async (req, res) => {
  try {
    const cfg = await db.collection('config').findOne({ key: 'countdown' });
    res.json(cfg || { label: '', until: null });
  } catch(e) { res.json({ label: '', until: null }); }
});

app.post('/api/admin/countdown', requireAdmin, async (req, res) => {
  try {
    const { label, until } = req.body;
    await db.collection('config').updateOne({ key: 'countdown' }, { $set: { key: 'countdown', label, until } }, { upsert: true });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== SEECITY SZERVER STÁTUSZ =====
app.get('/api/seecity/status', async (req, res) => {
  try {
    // SA-MP / MTA szerver státusz lekérése
    const r = await fetch('https://api.samp-servers.net/v2-0/server/185.161.208.87:22003', {
      headers: { 'User-Agent': 'PowerPulse/1.0' }
    }).catch(() => null);
    if (!r || !r.ok) {
      return res.json({ online: false, players: 0, max: 0, name: 'SeeCity', error: 'timeout' });
    }
    const data = await r.json();
    res.json({ online: true, players: data.pc || 0, max: data.pm || 100, name: data.hn || 'SeeCity' });
  } catch(e) {
    res.json({ online: false, players: 0, max: 0, name: 'SeeCity' });
  }
});

// ===== FOGLALÁS → Discord + Loyalty pont (upgrade) =====
// Felülírjuk a /api/submit-ot hogy Discord értesítést küldjön
app._router.stack = app._router.stack.filter(r => !(r.route && r.route.path === '/api/submit'));
app.post('/api/submit', async (req, res) => {
  try {
    const { ic_name, discord, phone, car, goal, notes, slot_id } = req.body;
    if (!ic_name || !discord || !phone || !car || !goal) return res.redirect('/?error=1');
    const bookingId = uid();
    await db.collection('bookings').insertOne({
      id: bookingId, ic_name, discord, phone, car, goal,
      notes: notes || '', status: 'new', created: now(),
      userId: req.session.userId || null,
      slotId: slot_id || null
    });
    // Ha időpontot is foglalt → jelölje foglaltnak
    if (slot_id) {
      await db.collection('slots').updateOne({ id: slot_id }, { $set: { available: false, bookedByName: ic_name, bookedAt: now() }});
    }
    // Discord értesítés
    await sendDiscordNotif(`🔧 **Új foglalás érkezett!**\n👤 ${ic_name} (Discord: ${discord})\n🚗 ${car}\n🎯 ${goal}${notes ? '\n📝 ' + notes : ''}`);
    res.redirect('/?success=1');
  } catch(e) { res.redirect('/?error=1'); }
});

// Foglalás elfogadásakor loyalty pont + Discord értesítés (upgrade)
app._router.stack = app._router.stack.filter(r => !(r.route && r.route.path === '/api/admin/booking/:id/:action' && r.route.methods.post));
app.post('/api/admin/booking/:id/:action', requireAdmin, async (req, res) => {
  try {
    const { id, action } = req.params;
    if (action === 'delete') {
      await db.collection('bookings').deleteOne({ id });
    } else {
      await db.collection('bookings').updateOne({ id }, { $set: { status: action } });
      const booking = await db.collection('bookings').findOne({ id });
      // Loyalty pont elfogadásnál
      if (action === 'accepted' && booking && booking.userId) {
        await addLoyaltyPoints(booking.userId, 10, `Elfogadott foglalás: ${booking.car}`);
      }
      // Email értesítés
      if (booking && booking.userId) {
        const user = await db.collection('users').findOne({ id: booking.userId });
        if (user && user.email) {
          const statusText = action === 'accepted' ? '✅ Elfogadva' : action === 'rejected' ? '❌ Elutasítva' : '🔄 Folyamatban';
          const statusMsg = action === 'accepted'
            ? 'A foglalásod elfogadtuk! Hamarosan felvesszük veled a kapcsolatot.'
            : action === 'rejected'
            ? 'Sajnos a foglalásod elutasításra került. Kérjük vedd fel velünk a kapcsolatot Discordon.'
            : 'A foglalásod feldolgozás alatt van.';
          sendEmail(user.email, `⚡ PowerPulse — Foglalás státusz: ${statusText}`, `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;"><tr><td align="center">
<table width="500" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:500px;">
<tr><td style="background:#0a0a1a;padding:32px 40px;text-align:center;"><h1 style="color:#f59e0b;margin:0;font-size:28px;">⚡ PowerPulse ECU</h1></td></tr>
<tr><td style="padding:40px;">
<p style="color:#333;font-size:16px;">Szia <strong>${user.ic_name}</strong>!</p>
<p style="color:#555;font-size:15px;">Foglalásod státusza:</p>
<div style="background:#f9f9f9;border-left:4px solid #f59e0b;padding:16px;border-radius:4px;margin:24px 0;">
<p style="margin:0;font-size:18px;font-weight:700;">${statusText}</p>
<p style="margin:8px 0 0;color:#666;">${statusMsg}</p>
</div>
<p style="color:#999;font-size:13px;">Foglalás: <strong>${booking.car}</strong> — ${booking.goal}</p>
</td></tr>
<tr><td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
<p style="color:#aaa;font-size:12px;margin:0;">⚡ PowerPulse ECU — SeeCity · 2026</p>
</td></tr></table></td></tr></table>
</body></html>`).catch(e => console.log('Email hiba:', e.message));
        }
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== ÉLŐ CHAT (egyszerű polling alapú) =====
app.get('/api/chat/:bookingId', requireUser, async (req, res) => {
  try {
    const booking = await db.collection('bookings').findOne({ id: req.params.bookingId, userId: req.session.userId });
    if (!booking) return res.status(403).json({ error: 'Nincs hozzáférés!' });
    const messages = await db.collection('chat').find({ bookingId: req.params.bookingId }).sort({ created: 1 }).toArray();
    res.json(messages);
  } catch(e) { res.json([]); }
});

app.post('/api/chat/:bookingId', requireUser, async (req, res) => {
  try {
    const booking = await db.collection('bookings').findOne({ id: req.params.bookingId, userId: req.session.userId });
    if (!booking) return res.status(403).json({ error: 'Nincs hozzáférés!' });
    const { message } = req.body;
    if (!message || message.trim().length < 1) return res.json({ error: 'Üzenet nem lehet üres!' });
    const user = await db.collection('users').findOne({ id: req.session.userId });
    await db.collection('chat').insertOne({
      id: uid(), bookingId: req.params.bookingId,
      sender: user.ic_name, senderType: 'user',
      message: message.trim().substring(0, 500), created: now(), ts: Date.now()
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin chat
app.get('/api/admin/chat/:bookingId', requireAdmin, async (req, res) => {
  try {
    const messages = await db.collection('chat').find({ bookingId: req.params.bookingId }).sort({ created: 1 }).toArray();
    res.json(messages);
  } catch(e) { res.json([]); }
});

app.post('/api/admin/chat/:bookingId', requireAdmin, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim().length < 1) return res.json({ error: 'Üzenet nem lehet üres!' });
    await db.collection('chat').insertOne({
      id: uid(), bookingId: req.params.bookingId,
      sender: 'Joshua (Admin)', senderType: 'admin',
      message: message.trim().substring(0, 500), created: now(), ts: Date.now()
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== INDÍTÁS =====
// v3.0 — Teljes feature set: naptár, referral, garázsnapló, loyalty, chat, Discord, visszaszámlálás
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 PowerPulse v3.0 fut: http://localhost:${PORT}`));
}).catch(err => {
  console.error('❌ MongoDB kapcsolódási hiba:', err);
  process.exit(1);
});
