import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { Deps } from "../deps";
import { parseBildirimTs, safeFileName } from "../util";

const KUNYE_NO_RE = /^\d{8,}$/;

/** Orijinal sunucudaki gibi: eksik/null alan boş metin olur, metinler kırpılır. */
const clean = (v: unknown, max = 500): string => {
  const t = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return t.length > max ? t.slice(0, max) : t;
};

interface ParsedRecord {
  kunyeNo: string;
  urun: string;
  tip: string;
  bildirimTarihi: string;
  uretimYeri: string;
  uretimTarihi: string;
  ureticiAdi: string;
  miktar: string;
  fiyat: string;
}

/** Geçerli (künye no >= 8 rakam ve ürün adı dolu) ise normalize edilmiş kaydı, değilse null döner. */
export function normalizeRecord(raw: unknown): ParsedRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kunyeNo = clean(r.kunyeNo, 64);
  const urun = clean(r.urun);
  if (!KUNYE_NO_RE.test(kunyeNo) || !urun) return null;
  return {
    kunyeNo,
    urun,
    tip: clean(r.tip),
    bildirimTarihi: clean(r.bildirimTarihi, 64),
    uretimYeri: clean(r.uretimYeri),
    uretimTarihi: clean(r.uretimTarihi, 64),
    ureticiAdi: clean(r.ureticiAdi),
    miktar: clean(r.miktar, 100),
    fiyat: clean(r.fiyat, 100),
  };
}

const EXT_MIME: Record<string, string> = {
  csv: "text/csv",
  html: "text/html",
  htm: "text/html",
  pdf: "application/pdf",
};
const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

const uuidSchema = z.string().uuid();

export function evraklarRoutes(d: Deps): Router {
  const r = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: d.config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10, fieldSize: 8 * 1024 * 1024 },
  });

  r.get("/evraklar", async (_req, res) => {
    const rows = (
      await d.pool.query(
        `SELECT e.id, e.ad, e.boyut, (e.s3_key IS NOT NULL) AS "dosyaVar",
                e.yukleme_zamani AS "yuklemeZamani", COUNT(k.kunye_no)::int AS adet
           FROM evraklar e LEFT JOIN kunyeler k ON k.evrak_id = e.id
          GROUP BY e.id ORDER BY e.yukleme_zamani DESC`,
      )
    ).rows;
    res.json(rows.map((x) => ({ ...x, boyut: x.boyut == null ? null : Number(x.boyut) })));
  });

  /**
   * Evrak yükleme: multipart/form-data
   *   file    : orijinal dosya (.csv/.html/.htm/.pdf) -> nesne deposunda arşivlenir
   *   ad      : dosya adı (UTF-8; multipart dosya adı kodlama sorunlarından kaçınmak için ayrı alan)
   *   records : tarayıcıda ayrıştırılmış künye kayıtları (JSON dizi)
   * Aynı künye no bir kez saklanır (üzerine yazma yok). Hiç yeni künye eklenmezse evrak kaydedilmez.
   */
  r.post("/evraklar", upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Dosya gerekli." });
      return;
    }
    const ad = safeFileName(typeof req.body?.ad === "string" && req.body.ad ? req.body.ad : file.originalname);
    const ext = extOf(ad);
    if (!EXT_MIME[ext]) {
      res.status(400).json({ error: "Desteklenmeyen dosya türü: " + ad });
      return;
    }
    if (ext === "pdf" && file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      res.status(400).json({ error: "Geçerli bir PDF dosyası değil: " + ad });
      return;
    }

    let rawRecords: unknown;
    try {
      rawRecords = JSON.parse(String(req.body?.records ?? ""));
    } catch {
      res.status(400).json({ error: "records geçerli bir JSON olmalı." });
      return;
    }
    if (!Array.isArray(rawRecords) || rawRecords.length > 20000) {
      res.status(400).json({ error: "records dizisi gerekli (en fazla 20000)." });
      return;
    }

    // Geçerli kayıtları ayır; geçersizleri say, aynı istekteki tekrarları ele.
    let invalid = 0;
    const byNo = new Map<string, ParsedRecord>();
    let inRequestDupes = 0;
    for (const raw of rawRecords) {
      const p = normalizeRecord(raw);
      if (!p) {
        invalid++;
        continue;
      }
      if (byNo.has(p.kunyeNo)) inRequestDupes++;
      else byNo.set(p.kunyeNo, p);
    }
    const recs = [...byNo.values()];
    const respondDuplicate = (skippedNos: string[]) =>
      res.json({
        evrakId: null,
        added: 0,
        skipped: skippedNos.length + inRequestDupes,
        skippedNos: skippedNos.slice(0, 50),
        invalid,
        duplicate: true,
      });
    if (recs.length === 0) {
      res.json({ evrakId: null, added: 0, skipped: 0, skippedNos: [], invalid, duplicate: false });
      return;
    }

    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const sameFile = await d.pool.query("SELECT 1 FROM evraklar WHERE sha256 = $1", [sha256]);
    if (sameFile.rowCount) {
      respondDuplicate(recs.map((x) => x.kunyeNo));
      return;
    }

    const evrakId = randomUUID();
    const key = `evraklar/${evrakId}`;
    const client = await d.pool.connect();
    let stored = false;
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO evraklar (id, ad, mime, boyut, sha256, s3_key, yukleyen)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [evrakId, ad, EXT_MIME[ext], file.size, sha256, key, req.user?.username ?? null],
      );

      const col = <T>(f: (x: ParsedRecord) => T) => recs.map(f);
      const ins = await client.query(
        `INSERT INTO kunyeler (kunye_no, urun, tip, bildirim_tarihi, bildirim_ts, uretim_yeri, uretim_tarihi,
                               uretici_adi, miktar, fiyat, kaynak_dosya, evrak_id)
         SELECT t.kunye_no, t.urun, t.tip, t.bildirim_tarihi, t.bildirim_ts, t.uretim_yeri, t.uretim_tarihi,
                t.uretici_adi, t.miktar, t.fiyat, $11, $12::uuid
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::text[],
                       $7::text[], $8::text[], $9::text[], $10::text[])
                AS t(kunye_no, urun, tip, bildirim_tarihi, bildirim_ts, uretim_yeri, uretim_tarihi,
                     uretici_adi, miktar, fiyat)
         ON CONFLICT (kunye_no) DO NOTHING
         RETURNING kunye_no`,
        [
          col((x) => x.kunyeNo),
          col((x) => x.urun),
          col((x) => x.tip),
          col((x) => x.bildirimTarihi),
          col((x) => parseBildirimTs(x.bildirimTarihi)?.toISOString() ?? null),
          col((x) => x.uretimYeri),
          col((x) => x.uretimTarihi),
          col((x) => x.ureticiAdi),
          col((x) => x.miktar),
          col((x) => x.fiyat),
          ad,
          evrakId,
        ],
      );
      const addedNos = new Set((ins.rows as { kunye_no: string }[]).map((x) => x.kunye_no));
      const skippedNos = recs.map((x) => x.kunyeNo).filter((no) => !addedNos.has(no));

      if (addedNos.size === 0) {
        // Evrağın tüm künyeleri zaten arşivde: evrak "daha önce yüklenmiş" sayılır, hiçbir şey saklanmaz.
        await client.query("ROLLBACK");
        respondDuplicate(skippedNos);
        return;
      }

      await d.store.put(key, file.buffer, EXT_MIME[ext]!);
      stored = true;
      await client.query("COMMIT");
      res.json({
        evrakId,
        added: addedNos.size,
        skipped: skippedNos.length + inRequestDupes,
        skippedNos: skippedNos.slice(0, 50),
        invalid,
        duplicate: false,
      });
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      if (stored) await d.store.delete(key).catch(() => {});
      if (e?.code === "23505") {
        // Aynı dosya eşzamanlı yüklendi (sha256 benzersizlik kısıtı)
        respondDuplicate(recs.map((x) => x.kunyeNo));
        return;
      }
      throw e;
    } finally {
      client.release();
    }
  });

  // Orijinal dosyayı indir (oturum gerekir; MinIO'ya tarayıcı doğrudan erişmez).
  r.get("/evraklar/:id/dosya", async (req, res) => {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "Geçersiz evrak kimliği." });
      return;
    }
    const row = (await d.pool.query("SELECT ad, mime, s3_key FROM evraklar WHERE id = $1", [id.data])).rows[0] as
      | { ad: string; mime: string | null; s3_key: string | null }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "Evrak bulunamadı." });
      return;
    }
    if (!row.s3_key) {
      res.status(404).json({ error: "Bu evrakın orijinal dosyası arşivlenmemiş (eski kayıt)." });
      return;
    }
    const obj = await d.store.get(row.s3_key);
    if (!obj) {
      res.status(404).json({ error: "Dosya nesne deposunda bulunamadı." });
      return;
    }
    res.set({
      "Content-Type": row.mime || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.ad)}`,
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store",
    });
    if (obj.size != null) res.set("Content-Length", String(obj.size));
    await pipeline(obj.body, res);
  });

  // Evrağı ve ondan gelen tüm künyeleri sil (orijinal dosya da silinir).
  r.delete("/evraklar/:id", async (req, res) => {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "Geçersiz evrak kimliği." });
      return;
    }
    const client = await d.pool.connect();
    try {
      await client.query("BEGIN");
      const cnt = await client.query("SELECT COUNT(*)::int AS n FROM kunyeler WHERE evrak_id = $1", [id.data]);
      const del = await client.query("DELETE FROM evraklar WHERE id = $1 RETURNING s3_key", [id.data]);
      if (!del.rowCount) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Evrak bulunamadı." });
        return;
      }
      await client.query("COMMIT");
      const key = del.rows[0].s3_key as string | null;
      if (key) await d.store.delete(key).catch((e) => console.warn("Dosya silinemedi:", key, e.message));
      res.json({ deleted: cnt.rows[0].n as number });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });

  return r;
}
