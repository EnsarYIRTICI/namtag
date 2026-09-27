import { Router } from "express";
import { z } from "zod";
import { ayarlariOku } from "../ayarlar";
import type { Deps } from "../deps";
import { kaydet } from "../islemKaydi";

const gunSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı.");

/**
 * Eksik evrak uyarısı. Bir günün evrakı "yüklenmiş" sayılır: o gün (Türkiye saatiyle) bildirilmiş en az bir
 * künye arşivde varsa. Hal künyesinin bildirim tarihi alım günüdür, bu yüzden evrak dosyasının adına ya da
 * yükleme zamanına değil bildirim tarihine bakılır.
 *
 * Pencere: son N gün (ayarlar: eksikGunPenceresi, varsayılan 30), bugün hariç (sabah evrakı henüz yüklenmemiş olabilir). Sistemdeki ilk künyeden önceki
 * günler sayılmaz. "Alım yapılmadı" diye işaretlenen günler eksik sayılmaz.
 */
export function eksiklerRoutes(d: Deps): Router {
  const r = Router();

  r.get("/eksikler", async (_req, res) => {
    const pencere = (await ayarlariOku(d.pool)).eksikGunPenceresi;
    const q = await d.pool.query(
      `WITH bugun AS (SELECT (now() AT TIME ZONE 'Europe/Istanbul')::date AS g),
            ilk AS (SELECT min((bildirim_ts AT TIME ZONE 'Europe/Istanbul')::date) AS g FROM kunyeler),
            aralik AS (
              -- GREATEST NULL'u yok sayar: arşiv boşken (ilk = NULL) aralık da NULL olmalı
              SELECT CASE WHEN (SELECT g FROM ilk) IS NULL THEN NULL
                          ELSE GREATEST((SELECT g FROM bugun) - $1::int, (SELECT g FROM ilk)) END AS bas,
                     (SELECT g FROM bugun) - 1 AS bit
            ),
            gunler AS (
              SELECT gs::date AS gun
                FROM aralik, generate_series(aralik.bas, aralik.bit, interval '1 day') gs
               WHERE aralik.bas IS NOT NULL
            ),
            dolu AS (
              SELECT DISTINCT (bildirim_ts AT TIME ZONE 'Europe/Istanbul')::date AS gun
                FROM kunyeler
               WHERE bildirim_ts >= now() - make_interval(days => $1::int + 2)
            )
       SELECT to_char(g.gun, 'YYYY-MM-DD') AS gun,
              m.gun IS NOT NULL AS muaf,
              COALESCE(m.isaretleyen, '') AS isaretleyen,
              to_char((SELECT bas FROM aralik), 'YYYY-MM-DD') AS bas,
              to_char((SELECT bit FROM aralik), 'YYYY-MM-DD') AS bit
         FROM gunler g
         LEFT JOIN eksik_gun_muaf m ON m.gun = g.gun
        WHERE NOT EXISTS (SELECT 1 FROM dolu WHERE dolu.gun = g.gun)
        ORDER BY g.gun DESC`,
      [pencere],
    );
    const rows = q.rows as { gun: string; muaf: boolean; isaretleyen: string }[];
    res.json({
      pencereGun: pencere,
      eksik: rows.filter((x) => !x.muaf).map((x) => x.gun),
      muaf: rows.filter((x) => x.muaf).map((x) => ({ gun: x.gun, isaretleyen: x.isaretleyen })),
    });
  });

  // "Bu gün alım yapılmadı": günü uyarılardan çıkar
  r.post("/eksikler/muaf", async (req, res) => {
    const g = gunSchema.safeParse(req.body?.gun);
    if (!g.success) {
      res.status(400).json({ error: g.error.issues[0]?.message });
      return;
    }
    try {
      await d.pool.query(
        `INSERT INTO eksik_gun_muaf (gun, isaretleyen) VALUES ($1::date, $2)
         ON CONFLICT (gun) DO UPDATE SET isaretleyen = EXCLUDED.isaretleyen, zaman = now()`,
        [g.data, req.user?.username ?? null],
      );
    } catch (e: any) {
      if (e?.code === "22008" || e?.code === "22007") {
        res.status(400).json({ error: "Geçersiz tarih." });
        return;
      }
      throw e;
    }
    await kaydet(d.pool, req, "muaf_isaretle", { gun: g.data });
    res.json({ ok: true });
  });

  // İşareti geri al
  r.delete("/eksikler/muaf/:gun", async (req, res) => {
    const g = gunSchema.safeParse(req.params.gun);
    if (!g.success) {
      res.status(400).json({ error: g.error.issues[0]?.message });
      return;
    }
    try {
      const del = await d.pool.query("DELETE FROM eksik_gun_muaf WHERE gun = $1::date", [g.data]);
      if (del.rowCount) await kaydet(d.pool, req, "muaf_geri_al", { gun: g.data });
    } catch (e: any) {
      if (e?.code === "22008" || e?.code === "22007") {
        res.status(400).json({ error: "Geçersiz tarih." });
        return;
      }
      throw e;
    }
    res.json({ ok: true });
  });

  return r;
}
