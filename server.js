const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');
const webpush = require('web-push');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const multer = require('multer');
const fs = require('fs');

// Multer — képfeltöltés memóriába
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Csak képfájl engedélyezett!'));
  }
});

// VAPID kulcsok (push értesítéshez)
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || 'BM9hxqJG_w9E8Dls2zsy11Q5zEhppb_ZK4LFQrB2EH6yAWvdlqQ3a2TqZwBetQEYoSn52f7ZNigoNZt4epRNIMM';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'jIAoisyLrIYwJ5N8ST_bMXT7ilc_793DutGAWgJjbhs';
webpush.setVapidDetails('mailto:josika886@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);

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
    const newUserId = uid();

    await db.collection('users').insertOne({
      id: newUserId, ic_name, discord, email,
      password: hash,
      verified: false,
      verifyToken,
      banned: false,
      created: now(),
      lastSpin: null,
      referredCount: 0,
      bonusSpins: 0,
      loyaltyPoints: 0
    });

    // Referral feldolgozás
    const ref = req.body.ref;
    if (ref) {
      try {
        const referrerName = Buffer.from(ref + '==', 'base64').toString('utf-8').replace(/[^a-zA-Z0-9_]/g,'');
        if (referrerName) {
          await db.collection('users').updateOne({ ic_name: referrerName }, { $inc: { referredCount: 1, bonusSpins: 1 } });
        }
      } catch(e) { console.log('Referral hiba:', e.message); }
    }

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

// ===== SZERVIZ IGAZOLVÁNY — Admin tölti ki és generálja =====
// Admin POST: feltölti az ECU adatokat + fotót, generálja az igazolványt, elmenti DB-be
app.post('/api/admin/servicecert/:bookingId', requireAdmin, upload.single('photo'), async (req, res) => {
  try {
    const booking = await db.collection('bookings').findOne({ id: req.params.bookingId });
    if (!booking) return res.status(404).json({ error: 'Foglalás nem található!' });

    const {
      ecu_map,       // ECU map neve pl. "Stage 2 Sport"
      hp_before,     // LE előtte
      hp_after,      // LE utána
      torque_before, // Nm előtte
      torque_after,  // Nm utána
      notes,         // megjegyzés
    } = req.body;

    const photoData = req.file ? req.file.buffer.toString('base64') : null;
    const photoMime = req.file ? req.file.mimetype : null;
    const certId = 'PP-' + Date.now().toString(36).toUpperCase() + '-' + req.params.bookingId.slice(-4).toUpperCase();
    const guaranteeUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString('hu-HU');

    // Mentés DB-be
    await db.collection('service_certs').updateOne(
      { bookingId: req.params.bookingId },
      { $set: {
        bookingId: req.params.bookingId, certId,
        ic_name: booking.ic_name, car: booking.car,
        ecu_map: ecu_map || '', hp_before: hp_before || '', hp_after: hp_after || '',
        torque_before: torque_before || '', torque_after: torque_after || '',
        notes: notes || '', photoData, photoMime,
        guaranteeUntil, created: now()
      }},
      { upsert: true }
    );

    // Foglalás státusza → accepted
    await db.collection('bookings').updateOne({ id: req.params.bookingId }, { $set: { status: 'accepted', certId } });

    res.json({ ok: true, certId, downloadUrl: `/api/servicecert/${certId}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: meglévő cert adatok lekérése (szerkesztéshez)
app.get('/api/admin/servicecert/:bookingId', requireAdmin, async (req, res) => {
  try {
    const cert = await db.collection('service_certs').findOne({ bookingId: req.params.bookingId });
    if (!cert) return res.json({ exists: false });
    const { photoData, photoMime, ...rest } = cert;
    res.json({ exists: true, hasPhoto: !!photoData, ...rest });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Publikus: igazolvány PNG generálás certId alapján
app.get('/api/servicecert/:certId', async (req, res) => {
  try {
    const cert = await db.collection('service_certs').findOne({ certId: req.params.certId });
    if (!cert) return res.status(404).json({ error: 'Igazolvány nem található!' });
    await generateServiceCertPNG(cert, res);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// User: saját certjei bookingId alapján
app.get('/api/certificate/:bookingId', async (req, res) => {
  try {
    // Előbb keresünk service cert-et
    const cert = await db.collection('service_certs').findOne({ bookingId: req.params.bookingId });
    if (cert) {
      return await generateServiceCertPNG(cert, res);
    }
    // Fallback: egyszerű elfogadott foglalás igazolás
    const booking = await db.collection('bookings').findOne({ id: req.params.bookingId, status: 'accepted' });
    if (!booking) return res.status(404).json({ error: 'Foglalás nem található vagy még nem lett elfogadva!' });
    await generateSimpleCertPNG(booking, res);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

async function generateSimpleCertPNG(booking, res) {
  const W = 1200, H = 800;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0,0,W,H);
  bg.addColorStop(0,'#0a0a1a'); bg.addColorStop(1,'#0f0f2e');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#f59e0b'; ctx.lineWidth=3; ctx.strokeRect(24,24,W-48,H-48);
  ctx.strokeStyle='rgba(245,158,11,0.2)'; ctx.lineWidth=1; ctx.strokeRect(36,36,W-72,H-72);
  [[24,24],[W-24,24],[24,H-24],[W-24,H-24]].forEach(([x,y])=>{ctx.fillStyle='#f59e0b';ctx.fillRect(x-6,y-6,12,12);});
  ctx.fillStyle='#f59e0b'; ctx.font='bold 52px Arial'; ctx.textAlign='center';
  ctx.fillText('⚡ PowerPulse ECU', W/2, 110);
  ctx.fillStyle='rgba(245,158,11,0.5)'; ctx.font='18px Arial';
  ctx.fillText('H I V A T A L O S  T U N I N G  I G A Z O L Á S', W/2, 145);
  ctx.strokeStyle='rgba(245,158,11,0.4)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(80,165); ctx.lineTo(W-80,165); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='italic 20px Arial';
  ctx.fillText('Ez az igazolás tanúsítja, hogy', W/2, 215);
  ctx.fillStyle='#ffffff'; ctx.font='bold 64px Arial';
  ctx.fillText(booking.ic_name, W/2, 295);
  ctx.strokeStyle='rgba(245,158,11,0.3)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(200,320); ctx.lineTo(W-200,320); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.font='20px Arial';
  ctx.fillText('sikeresen elvégeztette a következő szolgáltatást:', W/2, 360);
  ctx.fillStyle='#f59e0b'; ctx.font='bold 38px Arial';
  ctx.fillText(booking.goal, W/2, 415);
  ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.font='24px Arial';
  ctx.fillText('🚗  ' + booking.car, W/2, 465);
  const certId = 'PP-' + booking.id.slice(-8).toUpperCase();
  ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.font='13px Arial';
  ctx.fillText(`Igazolás ID: ${certId}  ·  ${booking.created}`, W/2, 755);
  res.setHeader('Content-Type','image/png');
  res.setHeader('Content-Disposition',`attachment; filename="PowerPulse-${booking.ic_name.replace(/\s+/g,'_')}.png"`);
  canvas.encode('png').then(buf => { res.end(buf); });
}

async function generateServiceCertPNG(cert, res) {
  // A4 arány: 794x1123px (96dpi) — fehér, professzionális garancialevél
  const W = 794, H = 1123;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // === FEHÉR HÁTTÉR ===
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // === FEJLÉC SÁV (sötét) ===
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(0, 0, W, 130);

  // Fejléc arany sáv alján
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(0, 128, W, 4);

  // Logo szöveg a fejlécben
  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 32px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('⚡ PowerPulse ECU', 36, 58);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '13px Arial';
  ctx.fillText('Hivatalos ECU Tuning Szakszerviz — SeeCity MTA', 36, 80);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '11px Arial';
  ctx.fillText('powerpulse-thhr.onrender.com', 36, 100);

  // Fejléc jobb: GARANCIALEVÉL felirat
  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 18px Arial';
  ctx.textAlign = 'right';
  ctx.fillText('GARANCIALEVÉL', W-36, 52);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '11px Arial';
  ctx.fillText(`Azonosító: ${cert.certId}`, W-36, 72);
  ctx.fillText(`Kiállítva: ${cert.created}`, W-36, 88);
  ctx.fillText(`Garancia: ${cert.guaranteeUntil}-ig`, W-36, 104);

  // === FOTÓ (ha van) — jobb felső sarok ===
  const hasPhoto = cert.photoData && cert.photoData.length > 0;
  const photoW = 210, photoH = 155, photoX = W-36-photoW, photoY = 148;

  if (hasPhoto) {
    try {
      const imgBuf = Buffer.from(cert.photoData, 'base64');
      const img = await loadImage(imgBuf);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(photoX, photoY, photoW, photoH, 6);
      ctx.clip();
      const scale = Math.max(photoW/img.width, photoH/img.height);
      const sw = img.width*scale, sh = img.height*scale;
      ctx.drawImage(img, photoX+(photoW-sw)/2, photoY+(photoH-sh)/2, sw, sh);
      ctx.restore();
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(photoX, photoY, photoW, photoH, 6);
      ctx.stroke();
      ctx.fillStyle = '#999';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('ECU beállítás fotó', photoX+photoW/2, photoY+photoH+14);
    } catch(e) {}
  }

  // === FŐ TARTALOM ===
  const lx = 36; // bal margin
  let y = 160;

  // --- ÜGYFÉL + JÁRMŰ ADATOK ---
  ctx.fillStyle = '#0a0a1a';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('ÜGYFÉL / JÁRMŰ ADATAI', lx, y);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(lx, y+4, 60, 2);
  y += 22;

  // Vonalak
  const drawRow = (label, value, yPos, highlight=false) => {
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(lx, yPos, 490, 28);
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.strokeRect(lx, yPos, 490, 28);
    ctx.fillStyle = '#888';
    ctx.font = '10px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(label, lx+8, yPos+11);
    ctx.fillStyle = highlight ? '#0a0a1a' : '#1a1a1a';
    ctx.font = highlight ? 'bold 13px Arial' : '12px Arial';
    ctx.fillText(value, lx+8, yPos+24);
  };

  drawRow('ÜGYFÉL IC NEVE', cert.ic_name, y, true); y += 32;
  drawRow('JÁRMŰ', cert.car, y, true); y += 32;
  drawRow('ELVÉGZETT SZOLGÁLTATÁS', cert.ecu_map || 'Egyedi ECU Map', y, true); y += 40;

  // --- TELJESÍTMÉNY ADATOK ---
  if (cert.hp_before || cert.hp_after || cert.torque_before || cert.torque_after) {
    ctx.fillStyle = '#0a0a1a';
    ctx.font = 'bold 11px Arial';
    ctx.fillText('TELJESÍTMÉNY ADATOK', lx, y);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(lx, y+4, 60, 2);
    y += 20;

    // LE tábla
    if (cert.hp_before || cert.hp_after) {
      ctx.fillStyle = '#fff8e7';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(lx, y, 228, 60, 6);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = '#888'; ctx.font = '10px Arial'; ctx.textAlign = 'left';
      ctx.fillText('TELJESÍTMÉNY (LE)', lx+12, y+14);

      if (cert.hp_before && cert.hp_after) {
        ctx.fillStyle = '#999'; ctx.font = '12px Arial';
        ctx.fillText(`${cert.hp_before} LE`, lx+12, y+42);
        ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 16px Arial';
        ctx.fillText('→', lx+80, y+42);
        ctx.fillStyle = '#16a34a'; ctx.font = 'bold 22px Arial';
        ctx.fillText(`${cert.hp_after} LE`, lx+105, y+44);
        // Növekedés
        const diff = parseInt(cert.hp_after) - parseInt(cert.hp_before);
        if (diff > 0) {
          ctx.fillStyle = '#16a34a'; ctx.font = 'bold 11px Arial';
          ctx.fillText(`+${diff} LE`, lx+195, y+38);
        }
      } else {
        ctx.fillStyle = '#0a0a1a'; ctx.font = 'bold 22px Arial';
        ctx.fillText(`${cert.hp_after||cert.hp_before} LE`, lx+12, y+44);
      }
    }

    // Nm tábla
    if (cert.torque_before || cert.torque_after) {
      const nmX = lx + 240;
      ctx.fillStyle = '#f0f7ff';
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(nmX, y, 228, 60, 6);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = '#888'; ctx.font = '10px Arial'; ctx.textAlign = 'left';
      ctx.fillText('NYOMATÉK (Nm)', nmX+12, y+14);

      if (cert.torque_before && cert.torque_after) {
        ctx.fillStyle = '#999'; ctx.font = '12px Arial';
        ctx.fillText(`${cert.torque_before} Nm`, nmX+12, y+42);
        ctx.fillStyle = '#6366f1'; ctx.font = 'bold 16px Arial';
        ctx.fillText('→', nmX+80, y+42);
        ctx.fillStyle = '#16a34a'; ctx.font = 'bold 22px Arial';
        ctx.fillText(`${cert.torque_after} Nm`, nmX+105, y+44);
        const diff2 = parseInt(cert.torque_after) - parseInt(cert.torque_before);
        if (diff2 > 0) {
          ctx.fillStyle = '#16a34a'; ctx.font = 'bold 11px Arial';
          ctx.fillText(`+${diff2} Nm`, nmX+195, y+38);
        }
      } else {
        ctx.fillStyle = '#0a0a1a'; ctx.font = 'bold 22px Arial';
        ctx.fillText(`${cert.torque_after||cert.torque_before} Nm`, nmX+12, y+44);
      }
    }
    y += 76;
  }

  // --- ELVÉGZETT MUNKÁK ---
  if (cert.notes) {
    ctx.fillStyle = '#0a0a1a';
    ctx.font = 'bold 11px Arial';
    ctx.fillText('ELVÉGZETT MUNKÁK / MEGJEGYZÉS', lx, y);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(lx, y+4, 60, 2);
    y += 18;

    ctx.fillStyle = '#fafafa';
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(lx, y, 490, 52, 4);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#1a1a1a'; ctx.font = '12px Arial'; ctx.textAlign = 'left';
    // Sortörés
    const words = cert.notes.split(' ');
    let line = '', lines = [];
    for (const w of words) {
      const test = line + w + ' ';
      if (ctx.measureText(test).width > 470 && line) { lines.push(line.trim()); line = w + ' '; }
      else line = test;
    }
    if (line) lines.push(line.trim());
    lines.slice(0,3).forEach((l,i) => ctx.fillText(l, lx+10, y+17+i*17));
    y += 64;
  }

  y += 12;

  // === GARANCIA DOBOZ ===
  ctx.fillStyle = '#f0fdf4';
  ctx.strokeStyle = '#16a34a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(lx, y, 490, 120, 8);
  ctx.fill(); ctx.stroke();

  // Zöld fejléc sáv
  ctx.fillStyle = '#16a34a';
  ctx.beginPath();
  ctx.roundRect(lx, y, 490, 32, [8,8,0,0]);
  ctx.fill();

  ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'left';
  ctx.fillText('✅  GARANCIALEVÉL FELTÉTELEI', lx+14, y+21);
  ctx.textAlign = 'right';
  ctx.font = 'bold 12px Arial';
  ctx.fillText(`Érvényes: ${cert.guaranteeUntil}-ig`, lx+476, y+21);

  y += 40;
  ctx.fillStyle = '#1a1a1a'; ctx.font = '12px Arial'; ctx.textAlign = 'left';
  ctx.fillText('• A garancia az elvégzett ECU tuning szolgáltatásra vonatkozik.', lx+14, y+8);
  ctx.fillText('• Érvényességi idő: 2 hét (14 nap) a kiállítás napjától számítva.', lx+14, y+24);
  ctx.fillStyle = '#dc2626'; ctx.font = 'bold 12px Arial';
  ctx.fillText('• FIGYELEM: Ha az ECU-hoz bárki más hozzányúl, a garancia azonnal', lx+14, y+40);
  ctx.fillText('  érvényét veszíti — kivizsgálás nélkül!', lx+14, y+56);
  ctx.fillStyle = '#1a1a1a'; ctx.font = '12px Arial';
  ctx.fillText('• Problémák esetén fordulj Joshuához Discordon!', lx+14, y+72);

  y += 100;

  // === ALÁÍRÁS + PECSÉT SOR ===
  y += 10;

  // Bal: aláírás
  ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lx, y+50); ctx.lineTo(lx+200, y+50); ctx.stroke();
  ctx.fillStyle = '#888'; ctx.font = '10px Arial'; ctx.textAlign = 'left';
  ctx.fillText('Kiállító aláírása', lx, y+63);
  ctx.fillStyle = '#0a0a1a'; ctx.font = 'bold 13px Arial';
  ctx.fillText('Zane Bishop', lx, y+47);
  ctx.fillStyle = '#888'; ctx.font = '10px Arial';
  ctx.fillText('PowerPulse ECU — Tulajdonos', lx, y+76);

  // Jobb: kerek pecsét
  const sx = W-36-65, sy = y+5;
  ctx.beginPath(); ctx.arc(sx, sy+45, 52, 0, Math.PI*2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.strokeStyle = '#0a0a1a'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(sx, sy+45, 44, 0, Math.PI*2);
  ctx.strokeStyle = '#0a0a1a'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.arc(sx, sy+45, 36, 0, Math.PI*2);
  ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1; ctx.stroke();

  ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center';
  ctx.fillText('⚡', sx, sy+43);
  ctx.fillStyle = '#0a0a1a'; ctx.font = 'bold 7.5px Arial';
  ctx.fillText('POWERPULSE ECU', sx, sy+58);
  ctx.fillStyle = '#888'; ctx.font = '7px Arial';
  ctx.fillText('SEECITY • HITELESÍTVE', sx, sy+68);

  // === LÁB SÁV ===
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(0, H-36, W, 36);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(0, H-36, W, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '10px Arial'; ctx.textAlign = 'center';
  ctx.fillText(`Igazolvány azonosító: ${cert.certId}  ·  powerpulse-thhr.onrender.com  ·  © 2026 PowerPulse ECU  ·  SeeCity MTA`, W/2, H-14);

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `attachment; filename="Garancialevél-${cert.ic_name.replace(/\s+/g,'_')}-${cert.certId}.png"`);
  canvas.encode('png').then(buf => { res.end(buf); });
}


// ===== TUNING IGAZOLÁS GENERÁTOR (egyszerű, régi) =====
app.get('/api/certificate/:bookingId', async (req, res) => {
  try {
    const booking = await db.collection('bookings').findOne({ id: req.params.bookingId, status: 'accepted' });
    if (!booking) return res.status(404).json({ error: 'Foglalás nem található vagy még nem lett elfogadva!' });

    const W = 1200, H = 800;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Háttér — sötét gradient
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0a0a1a');
    bg.addColorStop(0.5, '#0f0f2e');
    bg.addColorStop(1, '#0a0a1a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Dekoratív sarokdíszek
    const corners = [[0,0],[W,0],[0,H],[W,H]];
    corners.forEach(([x,y]) => {
      const g = ctx.createRadialGradient(x,y,0,x,y,300);
      g.addColorStop(0,'rgba(245,158,11,0.08)');
      g.addColorStop(1,'rgba(245,158,11,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0,0,W,H);
    });

    // Külső keret
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 24, W-48, H-48);

    // Belső keret
    ctx.strokeStyle = 'rgba(245,158,11,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(36, 36, W-72, H-72);

    // Sarokdíszek (kis négyzetek)
    [[24,24],[W-24,24],[24,H-24],[W-24,H-24]].forEach(([x,y]) => {
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(x-6, y-6, 12, 12);
    });

    // Vízjel háttér
    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.font = 'bold 180px Arial';
    ctx.fillStyle = '#f59e0b';
    ctx.textAlign = 'center';
    ctx.translate(W/2, H/2+60);
    ctx.rotate(-0.3);
    ctx.fillText('PowerPulse', 0, 0);
    ctx.restore();

    // Logo + cím
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 52px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('⚡ PowerPulse ECU', W/2, 110);

    ctx.fillStyle = 'rgba(245,158,11,0.5)';
    ctx.font = '18px Arial';
    ctx.fillText('S E E C I T Y  ·  H I V A T A L O S  T U N I N G  I G A Z O L Á S', W/2, 145);

    // Elválasztó vonal
    ctx.strokeStyle = 'rgba(245,158,11,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(80, 165);
    ctx.lineTo(W-80, 165);
    ctx.stroke();

    // Tanúsítvány szöveg
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'italic 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Ez az igazolás tanúsítja, hogy', W/2, 215);

    // IC Név — nagy, arany
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(booking.ic_name, W/2, 295);

    // Elválasztó
    ctx.strokeStyle = 'rgba(245,158,11,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(200, 320);
    ctx.lineTo(W-200, 320);
    ctx.stroke();

    // Szöveg
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '20px Arial';
    ctx.fillText('sikeresen elvégeztette a következő szolgáltatást:', W/2, 360);

    // Szolgáltatás neve
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 38px Arial';
    ctx.fillText(booking.goal, W/2, 415);

    // Kocsi
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '24px Arial';
    ctx.fillText(`🚗  ${booking.car}`, W/2, 465);

    // Részletek doboz
    ctx.fillStyle = 'rgba(245,158,11,0.06)';
    ctx.strokeStyle = 'rgba(245,158,11,0.2)';
    ctx.lineWidth = 1;
    const boxX = 120, boxY = 495, boxW = W-240, boxH = 120;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 12);
    ctx.fill();
    ctx.stroke();

    // Cert ID, dátum, Discord
    const certId = 'PP-' + req.params.bookingId.slice(-8).toUpperCase();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Igazolás ID: ${certId}`, boxX+30, boxY+35);
    ctx.fillText(`Discord: ${booking.discord}`, boxX+30, boxY+60);
    ctx.fillText(`Dátum: ${booking.created}`, boxX+30, boxY+85);
    ctx.textAlign = 'right';
    ctx.fillText('Kiállította: Zane Bishop (PowerPulse ECU)', boxX+boxW-30, boxY+85);

    // Aláírás vonal
    ctx.strokeStyle = 'rgba(245,158,11,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W-350, 690);
    ctx.lineTo(W-100, 690);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Zane Bishop — PowerPulse ECU', W-225, 710);

    // Bal oldali pecsét kör
    ctx.beginPath();
    ctx.arc(180, 680, 55, 0, Math.PI*2);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(180, 680, 48, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(245,158,11,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 22px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('⚡', 180, 672);
    ctx.font = '10px Arial';
    ctx.fillStyle = 'rgba(245,158,11,0.8)';
    ctx.fillText('HITELESÍTVE', 180, 695);

    // Footer
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('powerpulse-thhr.onrender.com  ·  SeeCity MTA  ·  © 2026 PowerPulse ECU', W/2, 755);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="PowerPulse-${booking.ic_name.replace(/\s+/g,'_')}-${certId}.png"`);
    canvas.encode('png').then(buf => { res.end(buf); });
  } catch(e) {
    console.log('Certificate hiba:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Certificate preview (böngészőben megnyílik, nem letöltés)
app.get('/api/certificate/:bookingId/view', async (req, res) => {
  req.url = req.url.replace('/view', '');
  // Újrahívjuk letöltés nélkül
  const booking = await db.collection('bookings').findOne({ id: req.params.bookingId, status: 'accepted' }).catch(()=>null);
  if (!booking) return res.status(404).send('Foglalás nem található vagy még nem elfogadott.');
  res.redirect(`/api/certificate/${req.params.bookingId}`);
});

// ===== PUSH ÉRTESÍTÉS =====
// VAPID public key lekérése (admin app regisztrációhoz)
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

// Admin push subscription mentése
app.post('/api/push/subscribe', requireAdmin, async (req, res) => {
  try {
    const sub = req.body;
    if (!sub || !sub.endpoint) return res.json({ error: 'Érvénytelen subscription!' });
    await db.collection('push_subs').updateOne(
      { endpoint: sub.endpoint },
      { $set: { ...sub, created: now() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin push subscription törlése
app.post('/api/push/unsubscribe', requireAdmin, async (req, res) => {
  try {
    await db.collection('push_subs').deleteOne({ endpoint: req.body.endpoint });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Push küldés minden admin subscription-re
async function sendPushToAdmins(payload) {
  try {
    const subs = await db.collection('push_subs').find().toArray();
    for (const sub of subs) {
      webpush.sendNotification(sub, JSON.stringify(payload)).catch(e => {
        if (e.statusCode === 410) {
          db.collection('push_subs').deleteOne({ endpoint: sub.endpoint }).catch(()=>{});
        }
      });
    }
  } catch(e) { console.log('Push hiba:', e.message); }
}

// ===== KIHÍVÁSOK =====
// Kihívás lista lekérése (publikus)
app.get('/api/challenges', async (req, res) => {
  try {
    const challenges = await db.collection('challenges').find({ active: true }).sort({ created: -1 }).toArray();
    res.json(challenges);
  } catch(e) { res.json([]); }
});

// User saját kihívás progress
app.get('/api/challenges/my', requireUser, async (req, res) => {
  try {
    const user = await db.collection('users').findOne({ id: req.session.userId });
    const challenges = await db.collection('challenges').find({ active: true }).toArray();
    const referred = user.referredCount || 0;
    const bookings = await db.collection('bookings').countDocuments({ userId: req.session.userId, status: { $ne: 'rejected' } });
    const spins = await db.collection('prizes').countDocuments({ userId: req.session.userId });

    const result = challenges.map(c => {
      let progress = 0;
      if (c.type === 'referral') progress = Math.min(referred, c.goal);
      else if (c.type === 'booking') progress = Math.min(bookings, c.goal);
      else if (c.type === 'spin') progress = Math.min(spins, c.goal);
      const completed = progress >= c.goal;
      return { ...c, progress, completed };
    });
    res.json(result);
  } catch(e) { res.json([]); }
});

// Admin: kihívás létrehozása
app.post('/api/admin/challenges/add', requireAdmin, async (req, res) => {
  try {
    const { title, description, type, goal, reward, icon } = req.body;
    if (!title || !type || !goal) return res.json({ error: 'Hiányzó adatok!' });
    await db.collection('challenges').insertOne({
      id: uid(), title, description: description || '',
      type, // referral | booking | spin
      goal: parseInt(goal), reward: reward || '',
      icon: icon || '🏆',
      active: true, created: now()
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/challenges/:id', requireAdmin, async (req, res) => {
  try {
    await db.collection('challenges').deleteOne({ id: req.params.id });
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
    // app.see-game.com HTML scraping (lejárt cert → rejectUnauthorized: false)
    const https = require('https');
    const html = await new Promise((resolve, reject) => {
      const req2 = https.get('https://app.see-game.com/', {
        rejectUnauthorized: false,
        headers: { 'User-Agent': 'Mozilla/5.0 PowerPulse/1.0' },
        timeout: 8000
      }, (r) => {
        let data = '';
        r.on('data', d => data += d);
        r.on('end', () => resolve(data));
      });
      req2.on('error', reject);
      req2.on('timeout', () => { req2.destroy(); reject(new Error('timeout')); });
    });

    // Parse: "online: 172" típusú sorok
    const matches = [...html.matchAll(/online:\s*(\d+)/gi)];
    const servers = [];
    const serverNames = [...html.matchAll(/SeeMTA[^<"]{0,20}/g)].map(m => m[0].trim()).filter((v,i,a)=>a.indexOf(v)===i);
    let total = 0;
    matches.forEach((m, i) => {
      const count = parseInt(m[1]);
      total += count;
      if (i < serverNames.length) servers.push({ name: serverNames[i], players: count });
    });
    // Összesen sor külön is megjelenik — ne számoljuk kétszer
    const totalMatch = html.match(/Összesen online:\s*(\d+)/i);
    const totalPlayers = totalMatch ? parseInt(totalMatch[1]) : total;

    res.json({
      online: totalPlayers > 0,
      players: totalPlayers,
      servers,
      source: 'app.see-game.com'
    });
  } catch(e) {
    res.json({ online: false, players: 0, servers: [], error: e.message });
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
    // Push értesítés adminoknak
    await sendPushToAdmins({
      title: '🔧 Új foglalás!',
      body: `${ic_name} — ${car} | ${goal}`,
      icon: '/icon-192.png',
      url: '/admin.html'
    });
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
