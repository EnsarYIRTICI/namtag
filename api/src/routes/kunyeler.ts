import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import type { KunyeRow } from "../types";
import { pruneEmptyEvraklar } from "./prune";

const SELECT = `
  SELECT kunye_no AS "kunyeNo", urun, COALESCE(tip,'') AS tip,
         COALESCE(bildirim_tarihi,'') AS "bildirimTarihi",
         COALESCE(uretim_yeri,'') AS "uretimYeri",
         COALESCE(uretim_tarihi,'') AS "uretimTarihi",
         COALESCE(uretici_adi,'') AS "ureticiAdi",
         COALESCE(miktar,'') AS miktar, COALESCE(fiyat,'') AS fiyat,
         COALESCE(kaynak_dosya,'') AS "kaynakDosya",
         evrak_id AS "evrakId", yukleme_zamani AS "yuklemeZamani"
    FROM kunyeler
   ORDER BY bildirim_ts DESC NULLS LAST, yukleme_zamani DESC`;

const cleanupBody = z.object({ days: z.coerce.number().int().min(1).max(3650).default(180) });

export function kunyelerRoutes(d: Deps): Router {
  const r = Router();

  r.get("/kunyeler", async (_req, res) => {
    const rows = (await d.pool.query(SELECT)).rows as KunyeRow[];
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
