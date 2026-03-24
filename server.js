const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

// ===== MONGODB =====
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://josika886_db_user:0mTMsuHGgB2aPISK@powerpulse.fbwh8gh.mongodb.net/?appName=powerpulse';
let db;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('powerpulse');
  console.log('✅ MongoDB csatlakozva!');

  // Alap admin config ha nincs még
  const cfg = await db.collection('config').findOne({ key: 'admin' });
  if (!cfg) {
    await db.collection('config').insertOne({ key: 'admin', username: 'Joshua', password: 'Hungary20030905' });
    console.log('✅ Admin config létrehozva');
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Helpers
const uid = () => 'ID_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
const now = () => new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' });

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({ secret: 'pp_secret_2026', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== API VÉGPONTOK =====

// Visitor tracking
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

// Hirdetmények
app.get('/api/announcements', async (req, res) => {
  try {
    const all = await db.collection('announcements').find({ active: true }).sort({ created: -1 }).toArray();
    res.json(all);
  } catch(e) { res.json([]); }
});

// Vélemények
app.get('/api/reviews', async (req, res) => {
  try {
    const all = await db.collection('reviews').find({ status: 'approved' }).sort({ created: -1 }).toArray();
    res.json(all);
  } catch(e) { res.json([]); }
});

// Foglalás beküldés
app.post('/api/submit', async (req, res) => {
  try {
    const { ic_name, discord, phone, car, goal, notes } = req.body;
    if (!ic_name || !discord || !phone || !car || !goal) return res.redirect('/?error=1');
    await db.collection('bookings').insertOne({
      id: uid(), ic_name, discord, phone, car, goal,
      notes: notes || '', status: 'new', created: now()
    });
    res.redirect('/?success=1');
  } catch(e) { res.redirect('/?error=1'); }
});

// Vélemény beküldés
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

// Nyeremény mentés
app.post('/api/prize', async (req, res) => {
  try {
    const { ic_name, ic_phone, prize, prize_text } = req.body;
    if (!ic_name || !prize) return res.status(400).json({ error: 'missing' });
    await db.collection('prizes').insertOne({
      id: uid(), ic_name, ic_phone: ic_phone || '', prize,
      prize_text: prize_text || '', status: 'pending', created: now()
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN API =====
const requireAdmin = (req, res, next) => {
  if (!req.session.admin) return res.status(401).json({ error: 'unauthorized' });
  next();
};

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
    const [bookings, reviews, announcements, prizes, visitors] = await Promise.all([
      db.collection('bookings').find().sort({ created: -1 }).toArray(),
      db.collection('reviews').find().sort({ created: -1 }).toArray(),
      db.collection('announcements').find().sort({ created: -1 }).toArray(),
      db.collection('prizes').find().sort({ created: -1 }).toArray(),
      db.collection('visitors').findOne({ key: 'stats' })
    ]);
    res.json({ bookings, reviews, announcements, prizes, visitors: visitors || {} });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/booking/:id/:action', requireAdmin, async (req, res) => {
  try {
    const { id, action } = req.params;
    if (action === 'delete') {
      await db.collection('bookings').deleteOne({ id });
    } else {
      await db.collection('bookings').updateOne({ id }, { $set: { status: action } });
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/review/:id/:action', requireAdmin, async (req, res) => {
  try {
    const { id, action } = req.params;
    if (action === 'delete') {
      await db.collection('reviews').deleteOne({ id });
    } else {
      await db.collection('reviews').updateOne({ id }, { $set: { status: action } });
    }
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

app.post('/api/admin/password', requireAdmin, async (req, res) => {
  try {
    if (req.body.new_password && req.body.new_password.length >= 4) {
      await db.collection('config').updateOne({ key: 'admin' }, { $set: { password: req.body.new_password } });
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Spin timeout kezelés
const spinTimeouts = {};

app.post('/api/spin/register', (req, res) => {
  const { ic_name } = req.body;
  const today = new Date().toISOString().split('T')[0];
  spinTimeouts[`${ic_name}_${today}`] = true;
  res.json({ ok: true });
});

app.get('/api/admin/spin-timeouts', requireAdmin, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const names = Object.keys(spinTimeouts)
    .filter(k => k.endsWith(today))
    .map(k => k.replace(`_${today}`, ''));
  res.json(names);
});

app.post('/api/admin/spin-reset/:name', requireAdmin, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  delete spinTimeouts[`${decodeURIComponent(req.params.name)}_${today}`];
  res.json({ ok: true });
});

// ===== INDÍTÁS =====
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 PowerPulse fut: http://localhost:${PORT}`));
}).catch(err => {
  console.error('❌ MongoDB kapcsolódási hiba:', err);
  process.exit(1);
});
