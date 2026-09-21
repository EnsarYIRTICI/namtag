#!/usr/bin/env node
// Yönetim komutları (sunucuda / container içinde):
//   node dist/cli.js user add <kullanici>       yeni kullanıcı (şifre ekranda görünmez)
//   node dist/cli.js user passwd <kullanici>    şifre değiştir (açık oturumlar kapanır)
//   node dist/cli.js user delete <kullanici>    kullanıcıyı sil
//   node dist/cli.js user list                  kullanıcıları listele
//   node dist/cli.js import-legacy <kunyeler.json> [users.json] [--force]
//                                               eski SQLite sürümünden veri aktar (README'ye bakın)
import fs from "node:fs";
import { Auth, normalizeUsername, validatePassword, validateUsername } from "./auth";
import { createPool, migrate } from "./db";
import { parseBildirimTs } from "./util";

function readHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      let buf = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (d) => (buf += d));
      process.stdin.on("end", () => resolve((buf.split("\n")[0] ?? "").replace(/\r$/, "")));
      return;
    }
    process.stdout.write(question);
    let s = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          return resolve(s);
        }
        if (c === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") s = s.slice(0, -1);
        else s += c;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function askNewPassword(): Promise<string> {
  const p1 = await readHidden("Yeni şifre (en az 10 karakter): ");
  const err = validatePassword(p1);
  if (err) fail(err);
  if (process.stdin.isTTY) {
    const p2 = await readHidden("Şifre (tekrar): ");
    if (p1 !== p2) fail("Şifreler eşleşmiyor.");
  }
  return p1;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function needUser(arg: string | undefined): string {
  const u = normalizeUsername(arg);
  if (!validateUsername(u)) fail("Geçersiz kullanıcı adı. 3-32 karakter; küçük harf, rakam, nokta, tire, alt çizgi.");
  return u;
}

const USAGE = `Kullanım:
  node dist/cli.js user add <kullanici>
  node dist/cli.js user passwd <kullanici>
  node dist/cli.js user delete <kullanici>
  node dist/cli.js user list
  node dist/cli.js import-legacy <kunyeler.json> [users.json] [--force]`;

/** sqlite3 -json boş tabloda hiçbir şey yazmaz; boş dosyayı [] say. */
function readJsonArray<T>(file: string): T[] {
  const txt = fs.readFileSync(file, "utf8").trim();
  if (!txt) return [];
  const v = JSON.parse(txt);
  if (!Array.isArray(v)) fail(`${file} bir JSON dizisi olmalı.`);
  return v as T[];
}

type LegacyKunye = Record<string, string | null | undefined>;
type LegacyUser = { username: string; passwordHash: string; createdAt?: number };

async function importLegacy(pool: ReturnType<typeof createPool>, args: string[]) {
  const force = args.includes("--force");
  const [kunyeFile, usersFile] = args.filter((a) => !a.startsWith("--"));
  if (!kunyeFile) fail(USAGE);
  const kunyeler = readJsonArray<LegacyKunye>(kunyeFile);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = (await client.query("SELECT COUNT(*)::int AS n FROM kunyeler")).rows[0].n as number;
    if (existing > 0 && !force) {
      fail(`Veritabanında zaten ${existing} künye var. Yine de aktarmak için --force kullanın (mevcut künye no'lar atlanır).`);
    }

    // Eski sürümde evrak tablosu yoktu: kaynakDosya adına göre evrak kaydı oluştur (orijinal dosya yok, s3_key NULL).
    const byFile = new Map<string, LegacyKunye[]>();
    for (const k of kunyeler) {
      const name = (k.kaynakDosya ?? "").trim();
      const arr = byFile.get(name) ?? [];
      arr.push(k);
      byFile.set(name, arr);
    }
    let added = 0;
    let skipped = 0;
    for (const [name, rows] of byFile) {
      const first = rows.map((r) => r.yuklemeZamani).filter(Boolean).sort()[0] ?? null;
      const ev = await client.query(
        "INSERT INTO evraklar (ad, yukleme_zamani, yukleyen) VALUES ($1, COALESCE($2::timestamptz, now()), 'eski-surum') RETURNING id",
        [name || "(evrak adı kayıtlı değil)", first],
      );
      const evrakId = ev.rows[0].id as string;
      for (const k of rows) {
        const r = await client.query(
          `INSERT INTO kunyeler (kunye_no, urun, tip, bildirim_tarihi, bildirim_ts, uretim_yeri, uretim_tarihi,
                                 uretici_adi, miktar, fiyat, kaynak_dosya, evrak_id, yukleme_zamani)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13::timestamptz, now()))
           ON CONFLICT (kunye_no) DO NOTHING`,
          [
            k.kunyeNo, k.urun, k.tip ?? "", k.bildirimTarihi ?? "",
            parseBildirimTs(k.bildirimTarihi)?.toISOString() ?? null,
            k.uretimYeri ?? "", k.uretimTarihi ?? "", k.ureticiAdi ?? "", k.miktar ?? "", k.fiyat ?? "",
            name, evrakId, k.yuklemeZamani ?? null,
          ],
        );
        if (r.rowCount) added++;
        else skipped++;
      }
    }
    // Hiç künyesi eklenmemiş (tamamı atlanan) evrak kayıtlarını temizle
    await client.query("DELETE FROM evraklar e WHERE NOT EXISTS (SELECT 1 FROM kunyeler k WHERE k.evrak_id = e.id)");

    let usersAdded = 0;
    if (usersFile) {
      const users = readJsonArray<LegacyUser>(usersFile);
      for (const u of users) {
        const r = await client.query(
          `INSERT INTO users (username, password_hash, created_at)
           VALUES ($1, $2, COALESCE(to_timestamp($3::double precision / 1000), now()))
           ON CONFLICT (username) DO NOTHING`,
          [u.username, u.passwordHash, u.createdAt ?? null],
        );
        usersAdded += r.rowCount ?? 0;
      }
    }
    await client.query("COMMIT");
    console.log(`Aktarım tamam: ${added} künye eklendi, ${skipped} atlandı, ${byFile.size} evrak, ${usersAdded} kullanıcı.`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  const [cmd, sub, arg] = process.argv.slice(2);
  if (!cmd) {
    console.log(USAGE);
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL tanımlı değil.");
  const pool = createPool(url);
  await migrate(pool);
  const auth = new Auth(pool, { idleMs: 3600_000, absoluteMs: 86400_000 });

  try {
    if (cmd === "user" && sub === "add") {
      const u = needUser(arg);
      if (await auth.userExists(u)) fail("Bu kullanıcı zaten var. Şifre için: passwd");
      await auth.createUser(u, await askNewPassword());
      console.log("Kullanıcı oluşturuldu: " + u);
    } else if (cmd === "user" && sub === "passwd") {
      const u = needUser(arg);
      if (!(await auth.userExists(u))) fail("Kullanıcı bulunamadı.");
      await auth.setPassword(u, await askNewPassword());
      console.log("Şifre güncellendi, bu kullanıcının açık oturumları kapatıldı.");
    } else if (cmd === "user" && sub === "delete") {
      const u = needUser(arg);
      console.log((await auth.deleteUser(u)) ? "Kullanıcı silindi: " + u : "Kullanıcı bulunamadı.");
    } else if (cmd === "user" && sub === "list") {
      const rows = await auth.listUsers();
      if (!rows.length) console.log("(kullanıcı yok)");
      for (const r of rows) console.log(r.username + "\t" + r.created_at.toISOString());
    } else if (cmd === "import-legacy") {
      await importLegacy(pool, process.argv.slice(3));
    } else {
      fail(USAGE);
    }
  } finally {
    auth.dispose();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
