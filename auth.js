'use strict';
// Kimlik dogrulama: scrypt sifre hash, sunucu tarafli oturumlar (SQLite), giris hiz siniri.
// Ek bagimlilik yok, sadece Node'un yerlesik crypto modulu kullanilir.

const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const COOKIE_NAME = 'kunye_sid';
const IDLE_MS = (parseInt(process.env.KUNYE_SESSION_IDLE_HOURS, 10) || 12) * 3600 * 1000;
const ABSOLUTE_MS = (parseInt(process.env.KUNYE_SESSION_MAX_DAYS, 10) || 7) * 86400 * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;

const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 };
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const KEY_LEN = 64;

// ---------- Sifre hash ----------

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(password, salt, KEY_LEN, { ...SCRYPT_PARAMS, maxmem: SCRYPT_MAXMEM });
  return ['scrypt', SCRYPT_PARAMS.N, SCRYPT_PARAMS.r, SCRYPT_PARAMS.p,
    salt.toString('base64'), dk.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const dk = await scrypt(password, salt, expected.length,
    { N: +N, r: +r, p: +p, maxmem: SCRYPT_MAXMEM });
  return crypto.timingSafeEqual(dk, expected);
}

// Kullanici yokken de ayni sureyi harcamak icin (kullanici adi sizdirmayi onler)
let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHashPromise;
}

function validateUsername(u) {
  return /^[a-z0-9._-]{3,32}$/.test(u);
}
function normalizeUsername(u) {
  return String(u || '').trim().toLowerCase();
}
function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 10) return 'Şifre en az 10 karakter olmalı.';
  if (p.length > 200) return 'Şifre çok uzun.';
  return null;
}

// ---------- Veritabani ----------

function initAuth(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt INTEGER NOT NULL,
      lastSeen INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
  `);
  db.pragma('foreign_keys = ON');

  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userCount: db.prepare('SELECT COUNT(*) AS n FROM users'),
    insertSession: db.prepare('INSERT INTO sessions (id, userId, createdAt, lastSeen, expiresAt) VALUES (?, ?, ?, ?, ?)'),
    sessionJoin: db.prepare(`
      SELECT s.id, s.userId, s.createdAt, s.lastSeen, s.expiresAt, u.username
      FROM sessions s JOIN users u ON u.id = s.userId WHERE s.id = ?`),
    touch: db.prepare('UPDATE sessions SET lastSeen = ?, expiresAt = ? WHERE id = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expiresAt < ?'),
  };

  const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    q.insertSession.run(sha256(token), userId, now, now, now + IDLE_MS);
    return token;
  }

  function getSession(token) {
    if (!token || token.length > 100) return null;
    const id = sha256(token);
    const s = q.sessionJoin.get(id);
    if (!s) return null;
    const now = Date.now();
    if (s.expiresAt < now || s.createdAt + ABSOLUTE_MS < now) {
      q.deleteSession.run(id);
      return null;
    }
    if (now - s.lastSeen > TOUCH_INTERVAL_MS) {
      q.touch.run(now, Math.min(now + IDLE_MS, s.createdAt + ABSOLUTE_MS), id);
    }
    return { userId: s.userId, username: s.username };
  }

  function destroySession(token) {
    if (token) q.deleteSession.run(sha256(token));
  }

  // Sadece giris denemesi icin: kullaniciyi bul, sifreyi dogrula (sabit sure)
  async function authenticate(username, password) {
    const user = q.userByName.get(username);
    const ok = await verifyPassword(password, user ? user.passwordHash : await getDummyHash());
    return user && ok ? user : null;
  }

  const purgeTimer = setInterval(() => q.purge.run(Date.now()), 3600 * 1000);
  purgeTimer.unref();
  q.purge.run(Date.now());

  return {
    createSession, getSession, destroySession, authenticate,
    userCount: () => q.userCount.get().n,
  };
}

// ---------- Cerez / yardimcilar ----------

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---------- Giris hiz siniri (bellekte) ----------

class FailLimiter {
  constructor(maxFails, windowMs) {
    this.max = maxFails;
    this.windowMs = windowMs;
    this.map = new Map();
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.map) if (v.resetAt < now) this.map.delete(k);
    }, 60 * 1000).unref();
  }
  retryAfterSec(key) {
    const v = this.map.get(key);
    if (!v || v.resetAt < Date.now() || v.count < this.max) return 0;
    return Math.ceil((v.resetAt - Date.now()) / 1000);
  }
  fail(key) {
    const now = Date.now();
    let v = this.map.get(key);
    if (!v || v.resetAt < now) v = { count: 0, resetAt: now + this.windowMs };
    v.count++;
    if (v.count >= this.max) v.resetAt = now + this.windowMs; // kilitlenince sure yenilenir
    this.map.set(key, v);
  }
  clear(key) { this.map.delete(key); }
}

module.exports = {
  COOKIE_NAME, ABSOLUTE_MS, initAuth, hashPassword, verifyPassword,
  validateUsername, normalizeUsername, validatePassword, parseCookies, FailLimiter,
};
