import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { Deps } from "../deps";

const MAX_KUNYE = 500;
const MAX_BEKLEYEN = 100;

const temizMetin = (max: number, bosMesaj?: string) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim())
    .pipe(bosMesaj ? z.string().min(1, bosMesaj).max(max) : z.string().max(max));

/** Künyesi henüz arşive gelmemiş ürün satırı. id: mevcut satır (güncelleme), yoksa yeni satır. */
const bekleyenSchema = z.object({
  id: z.string().uuid().optional(),
  urun: temizMetin(100, "Bekleyen ürünün adı boş olamaz."),
  aciklama: temizMetin(200).optional().default(""),
});

/** Liste kaydetme/güncelleme gövdesi. Künye numaraları sırası korunarak tekilleştirilir. */
export const listeBody = z
  .object({
    ad: temizMetin(100, "Liste adı boş olamaz."),
    kunyeNos: z
      .array(z.string().trim().regex(/^\d{8,64}$/, "Geçersiz künye numarası."))
      .max(MAX_KUNYE, `Bir listede en fazla ${MAX_KUNYE} künye olabilir.`)
      .transform((a) => [...new Set(a)]),
    bekleyenler: z
      .array(bekleyenSchema)
      .max(MAX_BEKLEYEN, `Bir listede en fazla ${MAX_BEKLEYEN} bekleyen ürün olabilir.`)
      .optional()
      .default([]),
  })
  .refine((b) => b.kunyeNos.length > 0 || b.bekleyenler.length > 0, {
    message: "Listede en az bir künye ya da bekleyen ürün olmalı.",
  });

type ListeBody = z.infer<typeof listeBody>;

const uuidSchema = z.string().uuid();

/**
 * Bekleyen satırın adayları: satır eklendikten SONRA arşive giren ve adı satırdaki metni içeren künyeler.
 * Her farklı ürün adı için en yeni künye (en fazla 5). Tek aday varsa arayüz doğrudan önerir, birden fazlaysa
 * (örn. "biber" -> sivri, çarliston, dolmalık) kullanıcı seçer. Eski künyeler bilerek önerilmez:
 * not düşüldüğünde arşivde olan künye zaten aramada bulunabilirdi, beklenen şey YENİ gelen evraktır.
 */
const BEKLEYENLER_JSON = `
  COALESCE((
    SELECT json_agg(json_build_object(
             'id', b.id, 'urun', b.urun, 'aciklama', b.aciklama, 'olusturma', b.olusturma,
             'adaylar', COALESCE(a.adaylar, '[]'::json)
           ) ORDER BY b.sira)
      FROM liste_bekleyenler b
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('kunyeNo', x.kunye_no, 'urun', x.urun, 'bildirimTarihi', x.bildirim_tarihi)
                        ORDER BY x.bildirim_ts DESC NULLS LAST) AS adaylar
          FROM (
            SELECT * FROM (
              SELECT DISTINCT ON (k.urun) k.kunye_no, k.urun, COALESCE(k.bildirim_tarihi, '') AS bildirim_tarihi, k.bildirim_ts
                FROM kunyeler k
               WHERE strpos(tr_fold(k.urun), tr_fold(b.urun)) > 0
                 AND k.yukleme_zamani >= b.olusturma
               ORDER BY k.urun, k.bildirim_ts DESC NULLS LAST, k.yukleme_zamani DESC
            ) son
            ORDER BY son.bildirim_ts DESC NULLS LAST
            LIMIT 5
          ) x
      ) a ON true
     WHERE b.liste_id = l.id
  ), '[]'::json)`;

const SELECT_LISTE = `
  SELECT l.id, l.ad, COALESCE(l.olusturan, '') AS olusturan,
         l.olusturma, l.guncelleme, l.son_yazdirma AS "sonYazdirma",
         COALESCE(array_agg(lk.kunye_no ORDER BY lk.sira) FILTER (WHERE lk.kunye_no IS NOT NULL), '{}') AS "kunyeNos",
         ${BEKLEYENLER_JSON} AS bekleyenler
    FROM listeler l
    LEFT JOIN liste_kunyeler lk ON lk.liste_id = l.id`;

/** Listenin künyelerini verilen sırayla yeniden yazar. Arşivde olmayan numaralar atlanır; eklenen sayıyı döner. */
async function writeItems(client: PoolClient, listeId: string, nos: string[]): Promise<number> {
  await client.query("DELETE FROM liste_kunyeler WHERE liste_id = $1", [listeId]);
  if (nos.length === 0) return 0;
  const ins = await client.query(
    `INSERT INTO liste_kunyeler (liste_id, kunye_no, sira)
     SELECT $1::uuid, t.no, t.sira::int
       FROM unnest($2::text[]) WITH ORDINALITY AS t(no, sira)
       JOIN kunyeler k ON k.kunye_no = t.no`,
    [listeId, nos],
  );
  return ins.rowCount ?? 0;
}

/**
 * Bekleyen satırları gövdedekiyle eşitler. id'si verilen satır güncellenir (eklenme zamanı korunur, böylece
 * eşleşme penceresi kaymaz); id'siz ya da artık bulunmayan satır yeni eklenir; gövdede olmayanlar silinir.
 */
async function writeBekleyenler(client: PoolClient, listeId: string, items: ListeBody["bekleyenler"]): Promise<void> {
  const kalan: string[] = [];
  for (const [i, b] of items.entries()) {
    if (b.id) {
      const u = await client.query(
        "UPDATE liste_bekleyenler SET urun = $3, aciklama = $4, sira = $5 WHERE id = $1 AND liste_id = $2 RETURNING id",
        [b.id, listeId, b.urun, b.aciklama, i + 1],
      );
      if (u.rowCount) {
        kalan.push(b.id);
        continue;
      }
    }
    const ins = await client.query(
      "INSERT INTO liste_bekleyenler (liste_id, urun, aciklama, sira) VALUES ($1, $2, $3, $4) RETURNING id",
      [listeId, b.urun, b.aciklama, i + 1],
    );
    kalan.push(ins.rows[0].id as string);
  }
  await client.query("DELETE FROM liste_bekleyenler WHERE liste_id = $1 AND id <> ALL($2::uuid[])", [listeId, kalan]);
}

/** Künye ve bekleyenleri yazar; kaydedilecek hiçbir şey kalmadıysa hata mesajı döner. */
async function writeAll(client: PoolClient, listeId: string, b: ListeBody): Promise<string | null> {
  const n = await writeItems(client, listeId, b.kunyeNos);
  await writeBekleyenler(client, listeId, b.bekleyenler);
  if (n === 0 && b.bekleyenler.length === 0) return "Seçilen künyelerin hiçbiri arşivde yok.";
  return null;
}

export function listelerRoutes(d: Deps): Router {
  const r = Router();

  const fetchOne = async (id: string) =>
    (await d.pool.query(`${SELECT_LISTE} WHERE l.id = $1 GROUP BY l.id`, [id])).rows[0];

  const parseBody = (body: unknown) => {
    const p = listeBody.safeParse(body ?? {});
    return p.success ? { data: p.data } : { error: p.error.issues[0]?.message ?? "Geçersiz istek." };
  };

  r.get("/listeler", async (_req, res) => {
    const rows = (await d.pool.query(`${SELECT_LISTE} GROUP BY l.id ORDER BY l.guncelleme DESC`)).rows;
    res.json(rows);
  });

  // Yeni liste kaydet
  r.post("/listeler", async (req, res) => {
    const b = parseBody(req.body);
    if (!b.data) {
      res.status(400).json({ error: b.error });
      return;
    }
    const client = await d.pool.connect();
    try {
      await client.query("BEGIN");
      const id = (
        await client.query("INSERT INTO listeler (ad, olusturan) VALUES ($1, $2) RETURNING id", [
          b.data.ad,
          req.user?.username ?? null,
        ])
      ).rows[0].id as string;
      const hata = await writeAll(client, id, b.data);
      if (hata) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: hata });
        return;
      }
      await client.query("COMMIT");
      res.status(201).json(await fetchOne(id));
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });

  // Mevcut listeyi güncelle (ad + künyeler komple değişir)
  r.put("/listeler/:id", async (req, res) => {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "Geçersiz liste kimliği." });
      return;
    }
    const b = parseBody(req.body);
    if (!b.data) {
      res.status(400).json({ error: b.error });
      return;
    }
    const client = await d.pool.connect();
    try {
      await client.query("BEGIN");
      const upd = await client.query("UPDATE listeler SET ad = $2, guncelleme = now() WHERE id = $1", [
        id.data,
        b.data.ad,
      ]);
      if (!upd.rowCount) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Liste bulunamadı (başka bir cihazdan silinmiş olabilir)." });
        return;
      }
      const hata = await writeAll(client, id.data, b.data);
      if (hata) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: hata });
        return;
      }
      await client.query("COMMIT");
      res.json(await fetchOne(id.data));
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });

  // Yazdırıldı olarak işaretle
  r.post("/listeler/:id/yazdirildi", async (req, res) => {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "Geçersiz liste kimliği." });
      return;
    }
    const upd = await d.pool.query("UPDATE listeler SET son_yazdirma = now() WHERE id = $1", [id.data]);
    if (!upd.rowCount) {
      res.status(404).json({ error: "Liste bulunamadı." });
      return;
    }
    res.json(await fetchOne(id.data));
  });

  r.delete("/listeler/:id", async (req, res) => {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "Geçersiz liste kimliği." });
      return;
    }
    const del = await d.pool.query("DELETE FROM listeler WHERE id = $1", [id.data]);
    if (!del.rowCount) {
      res.status(404).json({ error: "Liste bulunamadı." });
      return;
    }
    res.json({ ok: true });
  });

  return r;
}
