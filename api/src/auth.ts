import crypto from "node:crypto";
import { promisify } from "node:util";
import type { Pool } from "pg";

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

export const COOKIE_NAME = "kunye_sid";
const TOUCH_INTERVAL_MS = 60 * 1000;

// Parametreler eski (SQLite) sürümle aynı: eski şifre hash'leri olduğu gibi içe aktarılabilir.
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 };
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const KEY_LEN = 64;

// ---------- Şifre hash ----------

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(password, salt, KEY_LEN, { ...SCRYPT_PARAMS, maxmem: SCRYPT_MAXMEM });
  return ["scrypt", SCRYPT_PARAMS.N, SCRYPT_PARAMS.r, SCRYPT_PARAMS.p, salt.toString("base64"), dk.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const dk = await scrypt(password, salt, expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT_MAXMEM });
  return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
}

// Kullanıcı yokken de aynı süreyi harcamak için (kullanıcı adı sızdırmayı önler)
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(16).toString("hex"));
  return dummyHashPromise;
}

export const validateUsername = (u: string): boolean => /^[a-z0-9._-]{3,32}$/.test(u);
export const normalizeUsername = (u: unknown): string => String(u ?? "").trim().toLowerCase();
export function validatePassword(p: unknown): string | null {
  if (typeof p !== "string" || p.length < 10) return "Şifre en az 10 karakter olmalı.";
  if (p.length > 200) return "Şifre çok uzun.";
  return null;
}

// ---------- Çerez ----------

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const raw = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(raw);
    } catch {
      out[k] = raw;
    }
  }
  return out;
}

// ---------- Giriş hız sınırı (bellekte) ----------

export class FailLimiter {
  private map = new Map<string, { count: number; resetAt: number }>();
  private timer: NodeJS.Timeout;

  constructor(private max: number, private windowMs: number) {
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.map) if (v.resetAt < now) this.map.delete(k);
    }, 60 * 1000);
    this.timer.unref();
  }
  retryAfterSec(key: string): number {
    const v = this.map.get(key);
    if (!v || v.resetAt < Date.now() || v.count < this.max) return 0;
    return Math.ceil((v.resetAt - Date.now()) / 1000);
  }
  fail(key: string): void {
    const now = Date.now();
    let v = this.map.get(key);
    if (!v || v.resetAt < now) v = { count: 0, resetAt: now + this.windowMs };
    v.count++;
    if (v.count >= this.max) v.resetAt = now + this.windowMs; // kilitlenince süre yenilenir
    this.map.set(key, v);
  }
  clear(key: string): void {
    this.map.delete(key);
  }
  dispose(): void {
    clearInterval(this.timer);
  }
}

// ---------- Kullanıcı / oturum servisi ----------

export type Rol = "yonetici" | "personel";
export const ROLLER: readonly Rol[] = ["yonetici", "personel"];

export interface SessionUser {
  userId: number;
  username: string;
  rol: Rol;
}

export interface KullaniciSatiri {
  username: string;
  rol: Rol;
  aktif: boolean;
  createdAt: Date;
  sonGiris: Date | null;
  acikOturum: number;
}
export interface AuthOptions {
  idleMs: number;
  absoluteMs: number;
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export class Auth {
  private purgeTimer: NodeJS.Timeout;

  constructor(private pool: Pool, private opts: AuthOptions) {
    this.purgeTimer = setInterval(() => void this.purge().catch(() => {}), 3600 * 1000);
    this.purgeTimer.unref();
  }

  get absoluteMs(): number {
    return this.opts.absoluteMs;
  }

  purge(): Promise<unknown> {
    return this.pool.query("DELETE FROM sessions WHERE expires_at < $1", [Date.now()]);
  }

  async userCount(): Promise<number> {
    const r = await this.pool.query("SELECT COUNT(*)::int AS n FROM users");
    return r.rows[0].n as number;
  }

  async createUser(username: string, password: string, rol: Rol = "personel"): Promise<void> {
    const hash = await hashPassword(password);
    await this.pool.query("INSERT INTO users (username, password_hash, rol) VALUES ($1, $2, $3)", [username, hash, rol]);
  }

  /** Aktif yönetici sayısı (son yöneticiyi kaybetmeyi önlemek için). */
  async activeAdminCount(): Promise<number> {
    const r = await this.pool.query("SELECT COUNT(*)::int AS n FROM users WHERE rol = 'yonetici' AND aktif");
    return r.rows[0].n as number;
  }

  async setRole(username: string, rol: Rol): Promise<boolean> {
    const r = await this.pool.query("UPDATE users SET rol = $1 WHERE username = $2", [rol, username]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Kullanıcının tüm açık oturumlarını kapatır; kapatılan oturum sayısını döner. */
  async destroyUserSessions(username: string): Promise<number> {
    const r = await this.pool.query(
      "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = $1)",
      [username],
    );
    return r.rowCount ?? 0;
  }

  /** Şifreyi değiştirir ve kullanıcının tüm açık oturumlarını kapatır. false: kullanıcı yok. */
  async setPassword(username: string, password: string): Promise<boolean> {
    const hash = await hashPassword(password);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query("UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING id", [hash, username]);
      if (r.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query("DELETE FROM sessions WHERE user_id = $1", [r.rows[0].id]);
      await client.query("COMMIT");
      return true;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteUser(username: string): Promise<boolean> {
    const r = await this.pool.query("DELETE FROM users WHERE username = $1", [username]);
    return (r.rowCount ?? 0) > 0;
  }

  async userExists(username: string): Promise<boolean> {
    const r = await this.pool.query("SELECT 1 FROM users WHERE username = $1", [username]);
    return (r.rowCount ?? 0) > 0;
  }

  async listUsers(): Promise<KullaniciSatiri[]> {
    const r = await this.pool.query(
      `SELECT u.username, u.rol, u.aktif, u.created_at AS "createdAt", u.son_giris AS "sonGiris",
              (SELECT COUNT(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > $1) AS "acikOturum"
         FROM users u ORDER BY u.id`,
      [Date.now()],
    );
    return r.rows;
  }

  /** Sadece giriş denemesi için: kullanıcıyı bul, şifreyi doğrula (sabit süre). */
  async authenticate(
    username: string,
    password: string,
  ): Promise<{ id: number; username: string; aktif: boolean } | null> {
    const r = await this.pool.query("SELECT id, username, password_hash, aktif FROM users WHERE username = $1", [username]);
    const user = r.rows[0] as { id: number; username: string; password_hash: string; aktif: boolean } | undefined;
    const ok = await verifyPassword(password, user ? user.password_hash : await getDummyHash());
    return user && ok ? { id: user.id, username: user.username, aktif: user.aktif } : null;
  }

  /** Sadece şifre doğrulama (kendi şifresini değiştirirken mevcut şifre kontrolü). */
  async checkPassword(userId: number, password: string): Promise<boolean> {
    const r = await this.pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
    const hash = r.rows[0]?.password_hash as string | undefined;
    return verifyPassword(password, hash ?? (await getDummyHash()));
  }

  async markLogin(userId: number): Promise<void> {
    await this.pool.query("UPDATE users SET son_giris = now() WHERE id = $1", [userId]);
  }

  async createSession(userId: number): Promise<string> {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    await this.pool.query(
      "INSERT INTO sessions (id, user_id, created_at, last_seen, expires_at) VALUES ($1, $2, $3, $4, $5)",
      [sha256(token), userId, now, now, now + this.opts.idleMs],
    );
    return token;
  }

  async getSession(token: string | undefined): Promise<SessionUser | null> {
    if (!token || token.length > 100) return null;
    const id = sha256(token);
    const r = await this.pool.query(
      `SELECT s.user_id, s.created_at, s.last_seen, s.expires_at, u.username, u.rol, u.aktif
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
      [id],
    );
    const s = r.rows[0];
    if (!s) return null;
    const createdAt = Number(s.created_at);
    const lastSeen = Number(s.last_seen);
    const expiresAt = Number(s.expires_at);
    const now = Date.now();
    if (expiresAt < now || createdAt + this.opts.absoluteMs < now || !s.aktif) {
      await this.pool.query("DELETE FROM sessions WHERE id = $1", [id]);
      return null;
    }
    if (now - lastSeen > TOUCH_INTERVAL_MS) {
      await this.pool.query("UPDATE sessions SET last_seen = $1, expires_at = $2 WHERE id = $3", [
        now,
        Math.min(now + this.opts.idleMs, createdAt + this.opts.absoluteMs),
        id,
      ]);
    }
    return { userId: s.user_id as number, username: s.username as string, rol: s.rol as Rol };
  }

  async destroySession(token: string | undefined): Promise<void> {
    if (token) await this.pool.query("DELETE FROM sessions WHERE id = $1", [sha256(token)]);
  }

  dispose(): void {
    clearInterval(this.purgeTimer);
  }
}
