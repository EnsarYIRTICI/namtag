const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const {
  COOKIE_NAME,
  ABSOLUTE_MS,
  initAuth,
  validateUsername,
  normalizeUsername,
  parseCookies,
  FailLimiter,
} = require("./auth");

const DATA_DIR = process.env.KUNYE_DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "kunye.db");

// ---- Surum bilgisi: package.json surumu + calisan git commit kodu ----
// git komutu calistirmadan dogrudan .git klasorunden okunur (servis 'kunye' kullanicisiyla
// calisir; dosyalar root'a aitse 'git' "dubious ownership" hatasi verir). Servis her
// yeniden basladiginda guncellenir. .git yoksa (zip'ten kurulum) commit bos kalir.
function readGitCommit() {
  if (process.env.KUNYE_COMMIT)
    return String(process.env.KUNYE_COMMIT).slice(0, 7);
  try {
    const gitDir = path.join(__dirname, ".git");
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (!/^ref:/.test(head)) return head.slice(0, 7); // detached HEAD
    const ref = head.slice(4).trim();
    try {
      return fs.readFileSync(path.join(gitDir, ref), "utf8").trim().slice(0, 7);
    } catch {
      /* ref dosyasi yoksa packed-refs'e bak */
    }
    const packed = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8");
    const line = packed.split("\n").find((l) => l.endsWith(" " + ref));
    return line ? line.slice(0, 7) : "";
  } catch {
    return "";
  }
}
const VERSION_INFO = {
  version: require("./package.json").version,
  commit: readGitCommit(),
  startedAt: new Date().toISOString(),
};

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

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

// Ayni kunye no bir kez basilir: varsa DOKUNMA (ustune yazma yok, guncelleme yok).
// Duzeltme gerekirse PUT /api/kunyeler/:kunyeNo (arayuzdeki "Duzenle") kullanilir.
const insertStmt = db.prepare(`
INSERT INTO kunyeler (kunyeNo, urun, tip, bildirimTarihi, uretimYeri, uretimTarihi, ureticiAdi, miktar, fiyat, kaynakDosya, yuklemeZamani)
VALUES (@kunyeNo, @urun, @tip, @bildirimTarihi, @uretimYeri, @uretimTarihi, @ureticiAdi, @miktar, @fiyat, @kaynakDosya, @yuklemeZamani)
ON CONFLICT(kunyeNo) DO NOTHING
`);
const KUNYE_NO_RE = /^\d{8,}$/;
const EDITABLE = [
  "urun",
  "tip",
  "bildirimTarihi",
  "uretimYeri",
  "uretimTarihi",
  "ureticiAdi",
  "miktar",
  "fiyat",
];
const MAX_FIELD = 200;
const str = (v) =>
  typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();

const auth = initAuth(db);
if (auth.userCount() === 0) {
  console.warn(
    "UYARI: Hic kullanici yok, kimse giris yapamaz. Olusturmak icin: node manage-users.js add <kullanici_adi>",
  );
}

const app = express();
app.disable("x-powered-by");
// Nginx arkasindaysaniz KUNYE_TRUST_PROXY=1 verin (gercek IP ve HTTPS bilgisi icin)
if (process.env.KUNYE_TRUST_PROXY === "1") app.set("trust proxy", 1);

// Guvenlik basliklari
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
  });
  next();
});

// CSRF savunmasi: cerez SameSite=Strict + durum degistiren isteklerde Origin kontrolu
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS")
    return next();
  const origin = req.get("origin");
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== req.get("host"))
      return res.status(403).json({ error: "Gecersiz istek kaynagi." });
  }
  next();
});

const ipLimiter = new FailLimiter(8, 15 * 60 * 1000); // ayni IP: 15 dk'da 8 hatali deneme
const userLimiter = new FailLimiter(20, 15 * 60 * 1000); // ayni kullanici adi: 15 dk'da 20 (dagitik saldiri)

function setSessionCookie(req, res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.secure,
    path: "/",
    maxAge: ABSOLUTE_MS,
  });
}
function currentSession(req) {
  return auth.getSession(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}

// ---- Herkese acik (girissiz) uclar ----
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/vendor/tailwind.css", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "vendor", "tailwind.css")),
);

app.get("/login", (req, res) => {
  if (currentSession(req)) return res.redirect("/");
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/api/login", express.json({ limit: "2kb" }), async (req, res) => {
  const body = req.body || {};
  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  const ipKey = "ip:" + req.ip;
  const userKey = "u:" + username;

  const wait = Math.max(
    ipLimiter.retryAfterSec(ipKey),
    userLimiter.retryAfterSec(userKey),
  );
  if (wait > 0) {
    res.set("Retry-After", String(wait));
    return res
      .status(429)
      .json({
        error:
          "Çok fazla hatalı deneme. " +
          Math.ceil(wait / 60) +
          " dakika sonra tekrar deneyin.",
      });
  }
  if (!validateUsername(username) || !password || password.length > 200) {
    ipLimiter.fail(ipKey);
    return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
  }
  try {
    const user = await auth.authenticate(username, password);
    if (!user) {
      ipLimiter.fail(ipKey);
      userLimiter.fail(userKey);
      return res
        .status(401)
        .json({ error: "Kullanıcı adı veya şifre hatalı." });
    }
    ipLimiter.clear(ipKey);
    userLimiter.clear(userKey);
    setSessionCookie(req, res, auth.createSession(user.id));
    res.json({ ok: true, username: user.username });
  } catch (e) {
    console.error("Login hatasi:", e);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

app.post("/api/logout", (req, res) => {
  auth.destroySession(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: req.secure,
  });
  res.json({ ok: true });
});

// ---- Buradan sonrasi oturum gerektirir (arayuz dosyalari dahil) ----
app.use((req, res, next) => {
  const session = currentSession(req);
  if (session) {
    req.user = session;
    res.set("Cache-Control", "no-store");
    return next();
  }
  if (req.path.startsWith("/api/"))
    return res.status(401).json({ error: "Oturum gerekli." });
  return res.redirect("/login");
});

app.get("/api/me", (req, res) =>
  res.json({ username: req.user.username, ...VERSION_INFO }),
);

app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/kunyeler", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM kunyeler ORDER BY bildirimTarihi DESC")
    .all();
  res.json(rows);
});

app.post("/api/kunyeler/bulk", (req, res) => {
  const records = req.body && req.body.records;
  if (!Array.isArray(records))
    return res.status(400).json({ error: "records dizisi gerekli" });
  const now = new Date().toISOString();
  const tx = db.transaction((recs) => {
    let added = 0,
      invalid = 0;
    const skipped = [];
    for (const r of recs) {
      const kunyeNo = str(r && r.kunyeNo);
      const urun = str(r && r.urun);
      if (!KUNYE_NO_RE.test(kunyeNo) || !urun) {
        invalid++;
        continue;
      }
      const info = insertStmt.run({
        kunyeNo,
        urun,
        tip: str(r.tip),
        bildirimTarihi: str(r.bildirimTarihi),
        uretimYeri: str(r.uretimYeri),
        uretimTarihi: str(r.uretimTarihi),
        ureticiAdi: str(r.ureticiAdi),
        miktar: str(r.miktar),
        fiyat: str(r.fiyat),
        kaynakDosya: str(r.kaynakDosya),
        yuklemeZamani: now,
      });
      if (info.changes === 1) added++;
      else skipped.push(kunyeNo);
    }
    return { added, invalid, skipped };
  });
  const { added, invalid, skipped } = tx(records);
  res.json({
    added,
    skipped: skipped.length,
    skippedNos: skipped.slice(0, 50),
    invalid,
  });
});

app.put("/api/kunyeler/:kunyeNo", (req, res) => {
  const body = req.body || {};
  const vals = {};
  for (const k of EDITABLE) {
    if (k in body) {
      const v = str(body[k]);
      if (v.length > MAX_FIELD)
        return res.status(400).json({ error: k + " cok uzun." });
      vals[k] = v;
    }
  }
  if ("urun" in vals && !vals.urun)
    return res.status(400).json({ error: "Urun adi bos olamaz." });
  const keys = Object.keys(vals);
  if (keys.length === 0)
    return res.status(400).json({ error: "Guncellenecek alan yok." });
  // kunyeNo degistirilemez (kimlik); yanlissa sil + yeniden yukle
  const info = db
    .prepare(
      "UPDATE kunyeler SET " +
        keys.map((k) => k + " = @" + k).join(", ") +
        " WHERE kunyeNo = @kunyeNo",
    )
    .run({ ...vals, kunyeNo: req.params.kunyeNo });
  if (info.changes === 0)
    return res.status(404).json({ error: "Kunye bulunamadi." });
  res.json(
    db
      .prepare("SELECT * FROM kunyeler WHERE kunyeNo = ?")
      .get(req.params.kunyeNo),
  );
});

app.delete("/api/kunyeler/:kunyeNo", (req, res) => {
  const info = db
    .prepare("DELETE FROM kunyeler WHERE kunyeNo = ?")
    .run(req.params.kunyeNo);
  if (info.changes === 0)
    return res.status(404).json({ error: "Kunye bulunamadi." });
  res.json({ ok: true });
});

app.post("/api/kunyeler/cleanup", (req, res) => {
  const days = parseInt((req.body || {}).days, 10) || 180;
  const rows = db.prepare("SELECT kunyeNo, bildirimTarihi FROM kunyeler").all();
  const cutoff = Date.now() - days * 86400000;
  const del = db.prepare("DELETE FROM kunyeler WHERE kunyeNo = ?");
  let n = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const m = (r.bildirimTarihi || "").match(
        /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
      );
      if (!m) continue;
      const t = new Date(
        +m[3],
        +m[2] - 1,
        +m[1],
        +m[4],
        +m[5],
        +m[6],
      ).getTime();
      if (t && t < cutoff) {
        del.run(r.kunyeNo);
        n++;
      }
    }
  });
  tx();
  res.json({ deleted: n });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(
    `Kunye Arsivi v${VERSION_INFO.version}${VERSION_INFO.commit ? " (" + VERSION_INFO.commit + ")" : ""} ${HOST}:${PORT} adresinde calisiyor. Veritabani: ${DB_PATH}`,
  );
});
