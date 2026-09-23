import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import type { KunyeRow } from "../types";
import { pruneEmptyEvraklar } from "./prune";

const COLUMNS = `
  kunye_no AS "kunyeNo", urun, COALESCE(tip,'') AS tip,
  COALESCE(bildirim_tarihi,'') AS "bildirimTarihi",
  COALESCE(uretim_yeri,'') AS "uretimYeri",
  COALESCE(uretim_tarihi,'') AS "uretimTarihi",
  COALESCE(uretici_adi,'') AS "ureticiAdi",
  COALESCE(miktar,'') AS miktar, COALESCE(fiyat,'') AS fiyat,
  COALESCE(kaynak_dosya,'') AS "kaynakDosya",
  evrak_id AS "evrakId", yukleme_zamani AS "yuklemeZamani"`;

export const aramaQuery = z.object({
  q: z
    .string()
    .optional()
    .transform((s) => (s ?? "").trim().slice(0, 100)),
  limit: z.coerce.number().int().min(1).max(50).catch(20),
});

const bulBody = z.object({
  kunyeNos: z.array(z.string().trim().max(64)).max(500),
});

const cleanupBody = z.object({ days: z.coerce.number().int().min(1).max(3650).default(180) });

export function kunyelerRoutes(d: Deps): Router {
  const r = Router();

  /**
   * Ürün adına göre arama (Türkçe harf duyarsız, "içerir"). En yeni bildirim önce.
   * Tüm arşivi tarayıcıya göndermemek için sadece ilk `limit` sonuç döner; `toplam` eşleşen sayısıdır.
   */
  r.get("/kunyeler", async (req, res) => {
    const { q, limit } = aramaQuery.parse(req.query);
    if (!q) {
      res.json({ items: [], toplam: 0 });
      return;
    }
    const rows = (
      await d.pool.query(
        `SELECT ${COLUMNS}, COUNT(*) OVER()::int AS "_toplam"
           FROM kunyeler
          WHERE strpos(tr_fold(urun), tr_fold($1)) > 0
          ORDER BY bildirim_ts DESC NULLS LAST, yukleme_zamani DESC, kunye_no
          LIMIT $2`,
        [q, limit],
      )
    ).rows as (KunyeRow & { _toplam: number })[];
    res.json({
      items: rows.map(({ _toplam, ...k }) => k),
      toplam: rows[0]?._toplam ?? 0,
    });
  });

  // Arşivdeki toplam künye sayısı (arama panelindeki rozet için)
  r.get("/kunyeler/ozet", async (_req, res) => {
    const n = (await d.pool.query("SELECT COUNT(*)::int AS n FROM kunyeler")).rows[0].n as number;
    res.json({ toplam: n });
  });

  // Verilen numaralardan arşivde olanları, istenen sırayla döner (liste açma, seçimi tazeleme).
  r.post("/kunyeler/bul", async (req, res) => {
    const b = bulBody.safeParse(req.body ?? {});
    if (!b.success) {
      res.status(400).json({ error: "kunyeNos dizisi gerekli (en fazla 500)." });
      return;
    }
    const rows = (
      await d.pool.query(
        `SELECT ${COLUMNS}
           FROM unnest($1::text[]) WITH ORDINALITY AS t(no, sira)
           JOIN kunyeler k ON k.kunye_no = t.no
          ORDER BY t.sira`,
        [b.data.kunyeNos],
      )
    ).rows as KunyeRow[];
    res.json(rows);
  });

  r.delete("/kunyeler/:kunyeNo", async (req, res) => {
    const del = await d.pool.query("DELETE FROM kunyeler WHERE kunye_no = $1", [req.params.kunyeNo]);
    if (!del.rowCount) {
      res.status(404).json({ error: "Künye bulunamadı." });
      return;
    }
    await pruneEmptyEvraklar(d);
    res.json({ ok: true });
  });

  // Bildirim tarihi N günden eski kayıtları siler (tarihi okunamayanlara dokunmaz).
  r.post("/kunyeler/cleanup", async (req, res) => {
    const parsed = cleanupBody.safeParse(req.body ?? {});
    const days = parsed.success ? parsed.data.days : 180;
    const del = await d.pool.query(
      "DELETE FROM kunyeler WHERE bildirim_ts IS NOT NULL AND bildirim_ts < now() - make_interval(days => $1)",
      [days],
    );
    await pruneEmptyEvraklar(d);
    res.json({ deleted: del.rowCount ?? 0 });
  });

  return r;
}
