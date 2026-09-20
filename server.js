const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const {
  COOKIE_NAME, ABSOLUTE_MS, initAuth, validateUsername, normalizeUsername,
  parseCookies, FailLimiter,
} = require('./auth');

const DATA_DIR = process.env.KUNYE_DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'kunye.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS kunyeler (
  kunyeNo TEXT PRIMARY KEY,
  urun TEXT NOT NULL,
  tip TEXT,
  bildirimTarihi TEXT,
  uretimYeri TEXT,
  uretimTarihi TEXT,
  ureticiAdi TEXT,
  miktar TEXT,
  fiyat TEXT,
  kaynakDosya TEXT,
  yuklemeZamani TEXT
);
CREATE INDEX IF NOT EXISTS idx_urun ON kunyeler(urun);
`);

const upsertStmt = db.prepare(`
INSERT INTO kunyeler (kunyeNo, urun, tip, bildirimTarihi, uretimYeri, uretimTarihi, ureticiAdi, miktar, fiyat, kaynakDosya, yuklemeZamani)
VALUES (@kunyeNo, @urun, @tip, @bildirimTarihi, @uretimYeri, @uretimTarihi, @ureticiAdi, @miktar, @fiyat, @kaynakDosya, @yuklemeZamani)
ON CONFLICT(kunyeNo) DO UPDATE SET
  urun=excluded.urun, tip=excluded.tip, bildirimTarihi=excluded.bildirimTarihi,
  uretimYeri=excluded.uretimYeri, uretimTarihi=excluded.uretimTarihi, ureticiAdi=excluded.ureticiAdi,
  miktar=excluded.miktar, fiyat=excluded.fiyat, kaynakDosya=excluded.kaynakDosya, yuklemeZamani=excluded.yuklemeZamani
`);

const auth = initAuth(db);
if (auth.userCount() === 0) {
  console.warn('UYARI: Hic kullanici yok, kimse giris yapamaz. Olusturmak icin: node manage-users.js add <kullanici_adi>');
}

const app = express();
app.disable('x-powered-by');
// Nginx arkasindaysaniz KUNYE_TRUST_PROXY=1 verin (gercek IP ve HTTPS bilgisi icin)
if (process.env.KUNYE_TRUST_PROXY === '1') app.set('trust proxy', 1);

// Guvenlik basliklari
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

// CSRF savunmasi: cerez SameSite=Strict + durum degistiren isteklerde Origin kontrolu
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.get('origin');
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Gecersiz istek kaynagi.' });
  }
  next();
});

const ipLimiter = new FailLimiter(8, 15 * 60 * 1000);    // ayni IP: 15 dk'da 8 hatali deneme
const userLimiter = new FailLimiter(20, 15 * 60 * 1000); // ayni kullanici adi: 15 dk'da 20 (dagitik saldiri)

function setSessionCookie(req, res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/', maxAge: ABSOLUTE_MS,
  });
}
function currentSession(req) {
  return auth.getSession(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}

// ---- Herkese acik (girissiz) uclar ----
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/vendor/tailwind.css', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'vendor', 'tailwind.css')));

app.get('/login', (req, res) => {
  if (currentSession(req)) return res.redirect('/');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', express.json({ limit: '2kb' }), async (req, res) => {
  const body = req.body || {};
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  const ipKey = 'ip:' + req.ip;
  const userKey = 'u:' + username;

  const wait = Math.max(ipLimiter.retryAfterSec(ipKey), userLimiter.retryAfterSec(userKey));
  if (wait > 0) {
    res.set('Retry-After', String(wait));
    return res.status(429).json({ error: 'Çok fazla hatalı deneme. ' + Math.ceil(wait / 60) + ' dakika sonra tekrar deneyin.' });
  }
  if (!validateUsername(username) || !password || password.length > 200) {
    ipLimiter.fail(ipKey);
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }
  try {
    const user = await auth.authenticate(username, password);
    if (!user) {
      ipLimiter.fail(ipKey);
      userLimiter.fail(userKey);
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
    }
    ipLimiter.clear(ipKey);
    userLimiter.clear(userKey);
    setSessionCookie(req, res, auth.createSession(user.id));
    res.json({ ok: true, username: user.username });
  } catch (e) {
    console.error('Login hatasi:', e);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

app.post('/api/logout', (req, res) => {
  auth.destroySession(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'strict', secure: req.secure });
  res.json({ ok: true });
});

// ---- Buradan sonrasi oturum gerektirir (arayuz dosyalari dahil) ----
app.use((req, res, next) => {
  const session = currentSession(req);
  if (session) {
    req.user = session;
    res.set('Cache-Control', 'no-store');
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Oturum gerekli.' });
  return res.redirect('/login');
});

app.get('/api/me', (req, res) => res.json({ username: req.user.username }));

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/kunyeler', (req, res) => {
  const rows = db.prepare('SELECT * FROM kunyeler ORDER BY bildirimTarihi DESC').all();
  res.json(rows);
});

app.post('/api/kunyeler/bulk', (req, res) => {
  const records = req.body.records;
  if (!Array.isArray(records)) return res.status(400).json({ error: 'records dizisi gerekli' });
  const tx = db.transaction((recs) => {
    let n = 0;
    for (const r of recs) {
      if (!r.kunyeNo || !r.urun) continue;
      upsertStmt.run({
        kunyeNo: r.kunyeNo, urun: r.urun, tip: r.tip || '',
        bildirimTarihi: r.bildirimTarihi || '', uretimYeri: r.uretimYeri || '',
        uretimTarihi: r.uretimTarihi || '', ureticiAdi: r.ureticiAdi || '',
        miktar: r.miktar || '', fiyat: r.fiyat || '',
        kaynakDosya: r.kaynakDosya || '', yuklemeZamani: new Date().toISOString()
      });
      n++;
    }
    return n;
  });
  const n = tx(records);
  res.json({ inserted: n });
});

app.delete('/api/kunyeler/:kunyeNo', (req, res) => {
  db.prepare('DELETE FROM kunyeler WHERE kunyeNo = ?').run(req.params.kunyeNo);
  res.json({ ok: true });
});

app.post('/api/kunyeler/cleanup', (req, res) => {
  const days = parseInt(req.body.days, 10) || 180;
  const rows = db.prepare('SELECT kunyeNo, bildirimTarihi FROM kunyeler').all();
  const cutoff = Date.now() - days * 86400000;
  const del = db.prepare('DELETE FROM kunyeler WHERE kunyeNo = ?');
  let n = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const m = (r.bildirimTarihi || '').match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
      if (!m) continue;
      const t = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]).getTime();
      if (t && t < cutoff) { del.run(r.kunyeNo); n++; }
    }
  });
  tx();
  res.json({ deleted: n });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Kunye Arsivi ${HOST}:${PORT} adresinde calisiyor. Veritabani: ${DB_PATH}`);
});
