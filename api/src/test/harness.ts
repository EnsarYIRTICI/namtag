import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Readable } from "node:stream";
import { Pool } from "pg";
import { buildApp } from "../app";
import { Auth } from "../auth";
import { loadConfig } from "../config";
import { migrate } from "../db";
import type { ObjectStore, StoredObject } from "../storage";

/** Testlerde MinIO yerine bellek içi depo. */
export class MemoryStore implements ObjectStore {
  objects = new Map<string, Buffer>();
  async ensureBucket() {}
  async put(key: string, body: Buffer) {
    this.objects.set(key, body);
  }
  async get(key: string): Promise<StoredObject | null> {
    const b = this.objects.get(key);
    return b ? { body: Readable.from(b), size: b.length } : null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

export const ORIGIN = "https://kunye.test";

/**
 * Gerçek PostgreSQL üzerinde, her test dosyası için ayrı bir şemada tam API ayağa kaldırır.
 * TEST_DATABASE_URL tanımlı değilse bu testler atlanır (bkz. README > Geliştirme).
 */
export async function startHarness(databaseUrl: string) {
  const schema = "test_" + randomBytes(6).toString("hex");
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, max: 5, options: `-c search_path=${schema}` });
  await migrate(pool);

  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    S3_ACCESS_KEY: "x",
    S3_SECRET_KEY: "x",
    APP_ORIGIN: ORIGIN,
    MAX_UPLOAD_MB: "1",
  });
  const auth = new Auth(pool, { idleMs: 3600_000, absoluteMs: 86400_000 });
  const store = new MemoryStore();
  const app = buildApp({ config, pool, auth, store, version: { version: "test", commit: "", startedAt: "" } });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  await auth.createUser("tester", "test-sifresi-123");
  const login = await fetch(base + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "tester", password: "test-sifresi-123" }),
  });
  if (!login.ok) throw new Error("Test girişi başarısız: " + login.status);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;

  /** Oturumlu istek; JSON gövdeyi kendisi serileştirir. */
  async function call<T = any>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + path, {
      method,
      headers: {
        cookie,
        origin: ORIGIN,
        ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, data: data as T, headers: res.headers };
  }

  async function close() {
    await new Promise((r) => server.close(r));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }

  return { base, pool, store, call, close };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;

let seq = 0;
/** Geçerli görünümlü, benzersiz bir künye kaydı üretir. */
export function kunye(urun: string, bildirim: string, extra: Record<string, string> = {}) {
  seq++;
  return {
    kunyeNo: String(2000000000000000000n + BigInt(Date.now() % 1e9) * 1000n + BigInt(seq)),
    urun,
    tip: "GELENEKSEL(KONVANSİYONEL)",
    bildirimTarihi: bildirim,
    uretimYeri: "BURSA/İZNİK/MERKEZ KÖYLER",
    uretimTarihi: bildirim,
    ureticiAdi: "TEST ÜRETİCİ",
    miktar: "10 Kg",
    fiyat: "20 ₺",
    ...extra,
  };
}

/** Evrak yükleme isteği (tarayıcının yaptığı gibi: dosya + ayrıştırılmış kayıtlar). */
export function evrakForm(ad: string, records: unknown[], content = "%PDF-1.4 test " + Math.random()) {
  const f = new FormData();
  f.append("file", new Blob([content], { type: "application/pdf" }), ad);
  f.append("ad", ad);
  f.append("records", JSON.stringify(records));
  return f;
}
