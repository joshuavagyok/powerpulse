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
const BREVO_PASS = process.env.BREVO_PASS || '';
const BASE_URL = process.env.BASE_URL || 'https://powerpulse-thhr.onrender.com';

let db;

// ===== EMAIL =====
const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: { user: BREVO_USER, pass: BREVO_PASS }
});

async function sendVerificationEmail(email, token, ic_name) {
  const link = `${BASE_URL}/api/verify?token=${token}`;
  await transporter.sendMail({
    from: `"PowerPulse ECU" <${GMAIL_USER}>`,
    to: email,
    subject: '⚡ PowerPulse — Erősítsd meg a fiókodat!',
    html: `
      <div style="font-family:'Segoe UI',sans-serif;background:#0a0a1a;padding:40px;border-radius:16px;max-width:500px;margin:0 auto;">
        <h1 style="color:#f59e0b;font-size:1.8rem;margin-bottom:8px;">⚡ PowerPulse ECU</h1>
        <p style="color:#c0c0d0;font-size:1rem;">Szia <strong style="color:#fff">${ic_name}</strong>!</p>
        <p style="color:#c0c0d0;">A fiókod sikeresen létrejött. Kattints az alábbi gombra a megerősítéshez:</p>
        <a href="${link}" style="display:inline-block;margin:24px 0;padding:14px 32px;background:#f59e0b;color:#0a0a1a;border-radius:10px;font-weight:700;font-size:1rem;text-decoration:none;">
          ✅ Fiók megerősítése
        </a>
        <p style="color:#666;font-size:0.85rem;">Ha nem te regisztráltál, hagyd figyelmen kívül ezt az emailt.</p>
        <p style="color:#444;font-size:0.8rem;margin-top:32px;">⚡ PowerPulse ECU — SeeCity legjobb ECU tuning szolgáltatása</p>
      </div>
    `
  });
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

    // Email aszinkron küldés — nem blokkolja a választ
    sendVerificationEmail(email, verifyToken, ic_name)
      .then(() => console.log(`✅ Email elküldve: ${email}`))
      .catch(e => console.log(`❌ Email hiba: ${e.message}`));
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
      prize_text: prize_text || '', status: 'pending', created: now()
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
    if (action === 'delete') await db.collection('bookings').deleteOne({ id });
    else await db.collection('bookings').updateOne({ id }, { $set: { status: action } });
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

app.post('/api/admin/password', requireAdmin, async (req, res) => {
  try {
    if (req.body.new_password && req.body.new_password.length >= 4) {
      await db.collection('config').updateOne({ key: 'admin' }, { $set: { password: req.body.new_password } });
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== INDÍTÁS =====
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 PowerPulse fut: http://localhost:${PORT}`));
}).catch(err => {
  console.error('❌ MongoDB kapcsolódási hiba:', err);
  process.exit(1);
});
