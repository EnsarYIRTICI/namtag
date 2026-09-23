import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { Deps } from "../deps";

const MAX_KUNYE = 500;

/** Liste kaydetme/güncelleme gövdesi. Künye numaraları sırası korunarak tekilleştirilir. */
export const listeBody = z.object({
  ad: z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, "").trim())
    .pipe(z.string().min(1, "Liste adı boş olamaz.").max(100, "Liste adı en fazla 100 karakter olabilir.")),
  kunyeNos: z
    .array(z.string().trim().regex(/^\d{8,64}$/, "Geçersiz künye numarası."))
    .min(1, "Listede en az bir künye olmalı.")
    .max(MAX_KUNYE, `Bir listede en fazla ${MAX_KUNYE} künye olabilir.`)
    .transform((a) => [...new Set(a)]),
});

const uuidSchema = z.string().uuid();

const SELECT_LISTE = `
  SELECT l.id, l.ad, COALESCE(l.olusturan, '') AS olusturan,
         l.olusturma, l.guncelleme, l.son_yazdirma AS "sonYazdirma",
         COALESCE(array_agg(lk.kunye_no ORDER BY lk.sira) FILTER (WHERE lk.kunye_no IS NOT NULL), '{}') AS "kunyeNos"
    FROM listeler l
    LEFT JOIN liste_kunyeler lk ON lk.liste_id = l.id`;

/** Listenin künyelerini verilen sırayla yeniden yazar. Arşivde olmayan numaralar atlanır; eklenen sayıyı döner. */
async function writeItems(client: PoolClient, listeId: string, nos: string[]): Promise<number> {
  await client.query("DELETE FROM liste_kunyeler WHERE liste_id = $1", [listeId]);
  const ins = await client.query(
    `INSERT INTO liste_kunyeler (liste_id, kunye_no, sira)
     SELECT $1::uuid, t.no, t.sira::int
       FROM unnest($2::text[]) WITH ORDINALITY AS t(no, sira)
       JOIN kunyeler k ON k.kunye_no = t.no`,
    [listeId, nos],
  );
  return ins.rowCount ?? 0;
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
      const n = await writeItems(client, id, b.data.kunyeNos);
      if (n === 0) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Seçilen künyelerin hiçbiri arşivde yok." });
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
      const n = await writeItems(client, id.data, b.data.kunyeNos);
      if (n === 0) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Seçilen künyelerin hiçbiri arşivde yok." });
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
