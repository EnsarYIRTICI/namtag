#!/usr/bin/env node
'use strict';
// Kullanici yonetimi (sadece sunucuda, komut satirindan):
//   node manage-users.js add <kullanici>      yeni kullanici
//   node manage-users.js passwd <kullanici>   sifre degistir (acik oturumlar kapanir)
//   node manage-users.js delete <kullanici>   kullaniciyi ve oturumlarini sil
//   node manage-users.js list                 kullanicilari listele

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { hashPassword, validateUsername, normalizeUsername, validatePassword } = require('./auth');

const DATA_DIR = process.env.KUNYE_DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'kunye.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
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
`);

// Sifreyi ekranda gostermeden oku (TTY degilse stdin'den tek satir okur)
function readHidden(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => { buf += d; });
      process.stdin.on('end', () => resolve(buf.split('\n')[0].replace(/\r$/, '')));
      return;
    }
    process.stdout.write(question);
    let s = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n' || c === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(s);
        }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') s = s.slice(0, -1);
        else s += c;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function askNewPassword() {
  const p1 = await readHidden('Yeni şifre (en az 10 karakter): ');
  const err = validatePassword(p1);
  if (err) { console.error(err); process.exit(1); }
  if (process.stdin.isTTY) {
    const p2 = await readHidden('Şifre (tekrar): ');
    if (p1 !== p2) { console.error('Şifreler eşleşmiyor.'); process.exit(1); }
  }
  return p1;
}

function needUser(arg) {
  const u = normalizeUsername(arg);
  if (!validateUsername(u)) {
    console.error('Geçersiz kullanıcı adı. 3-32 karakter; küçük harf, rakam, nokta, tire, alt çizgi.');
    process.exit(1);
  }
  return u;
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);

  if (cmd === 'add') {
    const u = needUser(arg);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u)) {
      console.error('Bu kullanıcı zaten var. Şifre için: passwd'); process.exit(1);
    }
    const hash = await hashPassword(await askNewPassword());
    db.prepare('INSERT INTO users (username, passwordHash, createdAt) VALUES (?, ?, ?)').run(u, hash, Date.now());
    console.log('Kullanıcı oluşturuldu: ' + u);

  } else if (cmd === 'passwd') {
    const u = needUser(arg);
    const row = db.prepare('SELECT id FROM users WHERE username = ?').get(u);
    if (!row) { console.error('Kullanıcı bulunamadı.'); process.exit(1); }
    const hash = await hashPassword(await askNewPassword());
    db.transaction(() => {
      db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(hash, row.id);
      db.prepare('DELETE FROM sessions WHERE userId = ?').run(row.id);
    })();
    console.log('Şifre güncellendi, bu kullanıcının açık oturumları kapatıldı.');

  } else if (cmd === 'delete') {
    const u = needUser(arg);
    const r = db.prepare('DELETE FROM users WHERE username = ?').run(u);
    console.log(r.changes ? 'Kullanıcı silindi: ' + u : 'Kullanıcı bulunamadı.');

  } else if (cmd === 'list') {
    const rows = db.prepare('SELECT username, createdAt FROM users ORDER BY id').all();
    if (!rows.length) console.log('(kullanıcı yok)');
    for (const r of rows) console.log(r.username + '\t' + new Date(r.createdAt).toISOString());

  } else {
    console.log('Kullanım:\n  node manage-users.js add <kullanici>\n  node manage-users.js passwd <kullanici>\n  node manage-users.js delete <kullanici>\n  node manage-users.js list');
    process.exit(cmd ? 1 : 0);
  }
})();
