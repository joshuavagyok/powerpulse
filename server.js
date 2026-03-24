const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// ===== GITHUB BACKUP =====
const GH_TOKEN = process.env.GH_TOKEN || '';
const GH_REPO = 'joshuavagyok/powerpulse';
const GH_BRANCH = 'main';

async function githubBackup(filename, content) {
  if (!GH_TOKEN) { console.log('GH_TOKEN nincs beállítva!'); return; }
  try {
    const filePath = `data/${filename}`;
    const apiUrl = `https://api.github.com/repos/${GH_REPO}/contents/${filePath}`;
    const headers = {
      'Authorization': `token ${GH_TOKEN}`,
      'User-Agent': 'PowerPulse',
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };

    // SHA lekérése
    let sha = null;
    const getRes = await fetch(apiUrl, { headers });
    if (getRes.ok) {
      const getData = await getRes.json();
      sha = getData.sha || null;
    }

    // Feltöltés
    const encoded = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `backup: ${filename} - ${new Date().toISOString()}`,
        content: encoded,
        branch: GH_BRANCH,
        ...(sha ? { sha } : {})
      })
    });
    console.log(`GitHub backup: ${filename} → ${putRes.status}`);
  } catch(e) {
    console.log(`GitHub backup hiba (${filename}): ${e.message}`);
  }
}

function writeAndBackup(filename, data) {
  writeJSON(filename, data);
  githubBackup(filename, data).catch(console.error);
}

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Data könyvtár létrehozása
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Alap JSON fájlok inicializálása
const initFile = (file, def) => {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(def));
};
initFile('bookings.json', []);
initFile('reviews.json', []);
initFile('announcements.json', []);
initFile('prizes.json', []);
initFile('visitors.json', { total: 0, today: 0, date: '' });
initFile('config.json', { username: 'Joshua', password: 'Hungary20030905' });

// Helpers
const readJSON = (file) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return null; }
};
const writeJSON = (file, data) => {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
};
const uid = () => 'ID_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
const now = () => new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' });

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({ secret: 'pp_secret_2026', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== API VÉGPONTOK =====

// Visitor tracking
app.get('/api/track', (req, res) => {
  let v = readJSON('visitors.json');
  const today = new Date().toISOString().split('T')[0];
  if (v.date !== today) { v.today = 0; v.date = today; }
  if (!req.session.visited) {
    req.session.visited = true;
    v.total++; v.today++;
    writeAndBackup('visitors.json', v);
  }
  res.json(v);
});

// Hirdetmények
app.get('/api/announcements', (req, res) => {
  const all = readJSON('announcements.json') || [];
  res.json(all.filter(a => a.active && a.text));
});

// Vélemények
app.get('/api/reviews', (req, res) => {
  const all = readJSON('reviews.json') || [];
  res.json(all.filter(r => r.status === 'approved'));
});

// Foglalás beküldés
app.post('/api/submit', (req, res) => {
  const { ic_name, discord, phone, car, goal, notes } = req.body;
  if (!ic_name || !discord || !phone || !car || !goal) {
    return res.redirect('/?error=1');
  }
  const bookings = readJSON('bookings.json') || [];
  bookings.unshift({ id: uid(), ic_name, discord, phone, car, goal, notes: notes || '', status: 'new', created: now() });
  writeAndBackup('bookings.json', bookings);
  res.redirect('/?success=1');
});

// Vélemény beküldés
app.post('/api/review', (req, res) => {
  const { name, car, text, rating } = req.body;
  if (!name || !text || text.length < 5) return res.redirect('/?review_error=1');
  const reviews = readJSON('reviews.json') || [];
  reviews.push({ id: uid(), name, car: car || '', text, rating: parseInt(rating) || 5, status: 'pending', created: now() });
  writeAndBackup('reviews.json', reviews);
  res.redirect('/?review_sent=1');
});

// Nyeremény mentés
app.post('/api/prize', (req, res) => {
  const { ic_name, ic_phone, prize, prize_text } = req.body;
  if (!ic_name || !prize) return res.status(400).json({ error: 'missing' });
  const prizes = readJSON('prizes.json') || [];
  prizes.push({ id: uid(), ic_name, ic_phone: ic_phone || '', prize, prize_text: prize_text || '', status: 'pending', created: now() });
  writeAndBackup('prizes.json', prizes);
  res.json({ ok: true });
});

// ===== ADMIN API =====
const requireAdmin = (req, res, next) => {
  if (!req.session.admin) return res.status(401).json({ error: 'unauthorized' });
  next();
};

app.post('/api/admin/login', (req, res) => {
  const config = readJSON('config.json');
  if (req.body.username === config.username && req.body.password === config.password) {
    req.session.admin = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'wrong password' });
  }
});

app.get('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin.html');
});

app.get('/api/admin/data', requireAdmin, (req, res) => {
  res.json({
    bookings: readJSON('bookings.json') || [],
    reviews: readJSON('reviews.json') || [],
    announcements: readJSON('announcements.json') || [],
    prizes: readJSON('prizes.json') || [],
    visitors: readJSON('visitors.json') || {},
  });
});

app.post('/api/admin/booking/:id/:action', requireAdmin, (req, res) => {
  const bookings = readJSON('bookings.json') || [];
  const { id, action } = req.params;
  if (action === 'delete') {
    writeAndBackup('bookings.json', bookings.filter(b => b.id !== id));
  } else {
    bookings.forEach(b => { if (b.id === id) b.status = action; });
    writeAndBackup('bookings.json', bookings);
  }
  res.json({ ok: true });
});

app.post('/api/admin/review/:id/:action', requireAdmin, (req, res) => {
  const reviews = readJSON('reviews.json') || [];
  const { id, action } = req.params;
  if (action === 'delete') {
    writeAndBackup('reviews.json', reviews.filter(r => r.id !== id));
  } else {
    reviews.forEach(r => { if (r.id === id) r.status = action; });
    writeAndBackup('reviews.json', reviews);
  }
  res.json({ ok: true });
});

app.post('/api/admin/announcement', requireAdmin, (req, res) => {
  const { text, emoji, active, id } = req.body;
  const items = readJSON('announcements.json') || [];
  if (id) {
    // Módosítás
    items.forEach(a => { if (a.id === id) { a.text = text; a.emoji = emoji; a.active = active === 'true'; }});
  } else {
    // Új
    if (text) items.unshift({ id: uid(), emoji: emoji || '📢', text, active: true, created: now() });
  }
  writeAndBackup('announcements.json', items);
  res.json({ ok: true });
});

app.post('/api/admin/announcement/:id/toggle', requireAdmin, (req, res) => {
  const items = readJSON('announcements.json') || [];
  items.forEach(a => { if (a.id === req.params.id) a.active = !a.active; });
  writeAndBackup('announcements.json', items);
  res.json({ ok: true });
});

app.delete('/api/admin/announcement/:id', requireAdmin, (req, res) => {
  const items = readJSON('announcements.json') || [];
  writeAndBackup('announcements.json', items.filter(a => a.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/admin/prize/:id/done', requireAdmin, (req, res) => {
  const prizes = readJSON('prizes.json') || [];
  prizes.forEach(p => { if (p.id === req.params.id) p.status = 'done'; });
  writeAndBackup('prizes.json', prizes);
  res.json({ ok: true });
});

app.post('/api/admin/password', requireAdmin, (req, res) => {
  const config = readJSON('config.json');
  if (req.body.new_password && req.body.new_password.length >= 4) {
    config.password = req.body.new_password;
    writeJSON('config.json', config);
  }
  res.json({ ok: true });
});

// Spin timeout kezelés (szerver oldali)
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

app.listen(PORT, () => console.log(`PowerPulse fut: http://localhost:${PORT}`));

// ===== STARTUP: Visszatöltés GitHub-ból =====
async function restoreFromGithub(filename) {
  if (!GH_TOKEN) return;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GH_REPO}/contents/data/${filename}`,
      { headers: { 'Authorization': `token ${GH_TOKEN}`, 'User-Agent': 'PowerPulse', 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.content) {
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        fs.writeFileSync(path.join(DATA_DIR, filename), content);
        console.log(`✅ Visszaállítva: ${filename}`);
      }
    }
  } catch(e) { console.log(`Restore skip (${filename}): ${e.message}`); }
}

// Induláskor visszatöltés
(async () => {
  console.log('🔄 GitHub backup visszatöltése...');
  await restoreFromGithub('bookings.json');
  await restoreFromGithub('reviews.json');
  await restoreFromGithub('prizes.json');
  await restoreFromGithub('announcements.json');
  await restoreFromGithub('config.json');
  console.log('✅ Visszatöltés kész!');
})();
