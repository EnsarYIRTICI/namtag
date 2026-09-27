import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { ROLLER, normalizeUsername, validatePassword, validateUsername, type Rol } from "../auth";
import { ayarGuncelleSchema, ayarTutarlilik, ayarlariOku, type Ayarlar } from "../ayarlar";
import type { Deps } from "../deps";
import { kaydet } from "../islemKaydi";

/** Sadece yöneticinin geçebileceği uçlar için. Oturum kontrolünden sonra kullanılır. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.rol !== "yonetici") {
    res.status(403).json({ error: "Bu işlem için yönetici yetkisi gerekli." });
    return;
  }
  next();
}

const rolSchema = z.enum(ROLLER as [Rol, ...Rol[]]);
const yeniKullaniciSchema = z.object({
  username: z.string(),
  password: z.string(),
  rol: rolSchema.default("personel"),
});
const kullaniciGuncelleSchema = z
  .object({ rol: rolSchema.optional(), aktif: z.boolean().optional() })
  .strict()
  .refine((x) => x.rol !== undefined || x.aktif !== undefined, "Değiştirilecek alan yok.");

const islemSorgu = z.object({
  kullanici: z.string().trim().max(64).optional(),
  islem: z.string().trim().max(64).optional(),
  once: z.coerce.number().int().positive().optional(), // bu id'den eski kayıtlar (sayfalama)
  limit: z.coerce.number().int().min(1).max(200).catch(50),
});

type Degisiklik = { rol?: Rol; aktif?: boolean; sil?: true };

/**
 * Rol/aktiflik değişikliği ya da silme. Hiç aktif yönetici kalmayacaksa reddeder. Yönetici satırları
 * kilitlenir: iki yönetici aynı anda birbirini düşüremez. Pasifleştirmede açık oturumlar kapanır.
 * Hata mesajı ya da null döner; kullanıcı yoksa "yok".
 */
async function kullaniciDegistir(d: Deps, username: string, x: Degisiklik): Promise<string | null | "yok"> {
  const client = await d.pool.connect();
  try {
    await client.query("BEGIN");
    const yoneticiler = (
      await client.query("SELECT username FROM users WHERE rol = 'yonetici' AND aktif ORDER BY id FOR UPDATE")
    ).rows.map((r) => r.username as string);
    const hedef = (await client.query("SELECT id, rol, aktif FROM users WHERE username = $1 FOR UPDATE", [username]))
      .rows[0] as { id: number; rol: Rol; aktif: boolean } | undefined;
    if (!hedef) {
      await client.query("ROLLBACK");
      return "yok";
    }
    const sonrakiYonetici = !x.sil && (x.rol ?? hedef.rol) === "yonetici" && (x.aktif ?? hedef.aktif);
    const kalan = yoneticiler.filter((u) => u !== username).length + (sonrakiYonetici ? 1 : 0);
    if (kalan === 0) {
      await client.query("ROLLBACK");
      return "En az bir aktif yönetici kalmalı.";
    }
    if (x.sil) {
      await client.query("DELETE FROM users WHERE id = $1", [hedef.id]);
    } else {
      if (x.rol !== undefined) await client.query("UPDATE users SET rol = $1 WHERE id = $2", [x.rol, hedef.id]);
      if (x.aktif !== undefined) await client.query("UPDATE users SET aktif = $1 WHERE id = $2", [x.aktif, hedef.id]);
      if (x.aktif === false) await client.query("DELETE FROM sessions WHERE user_id = $1", [hedef.id]);
    }
    await client.query("COMMIT");
    return null;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export function yonetimRoutes(d: Deps): Router {
  const r = Router();
  r.use("/admin", requireAdmin);

  // ---------- Kullanıcılar ----------

  r.get("/admin/kullanicilar", async (_req, res) => {
    res.json(await d.auth.listUsers());
  });

  r.post("/admin/kullanicilar", async (req, res) => {
    const b = yeniKullaniciSchema.safeParse(req.body ?? {});
    if (!b.success) {
      res.status(400).json({ error: "Kullanıcı adı, şifre ve geçerli bir rol gerekli." });
      return;
    }
    const username = normalizeUsername(b.data.username);
    if (!validateUsername(username)) {
      res.status(400).json({ error: "Geçersiz kullanıcı adı. 3-32 karakter; küçük harf, rakam, nokta, tire, alt çizgi." });
      return;
    }
    const perr = validatePassword(b.data.password);
    if (perr) {
      res.status(400).json({ error: perr });
      return;
    }
    try {
      await d.auth.createUser(username, b.data.password, b.data.rol);
    } catch (e: any) {
      if (e?.code === "23505") {
        res.status(409).json({ error: "Bu kullanıcı adı zaten var." });
        return;
      }
      throw e;
    }
    await kaydet(d.pool, req, "kullanici_ekle", { hedef: username, rol: b.data.rol });
    res.status(201).json({ ok: true });
  });

  r.patch("/admin/kullanicilar/:username", async (req, res) => {
    const username = normalizeUsername(req.params.username);
    const b = kullaniciGuncelleSchema.safeParse(req.body ?? {});
    if (!b.success) {
      res.status(400).json({ error: b.error.issues[0]?.message ?? "Geçersiz istek." });
      return;
    }
    if (username === req.user!.username) {
      res.status(400).json({ error: "Kendi rolünüzü ya da hesabınızın durumunu değiştiremezsiniz." });
      return;
    }
    const sonuc = await kullaniciDegistir(d, username, b.data);
    if (sonuc === "yok") {
      res.status(404).json({ error: "Kullanıcı bulunamadı." });
      return;
    }
    if (sonuc) {
      res.status(409).json({ error: sonuc });
      return;
    }
    if (b.data.rol !== undefined) await kaydet(d.pool, req, "kullanici_rol", { hedef: username, rol: b.data.rol });
    if (b.data.aktif !== undefined) await kaydet(d.pool, req, "kullanici_aktif", { hedef: username, aktif: b.data.aktif });
    res.json({ ok: true });
  });

  r.post("/admin/kullanicilar/:username/sifre", async (req, res) => {
    const username = normalizeUsername(req.params.username);
    const password = (req.body ?? {}).password;
    const perr = validatePassword(password);
    if (perr) {
      res.status(400).json({ error: perr });
      return;
    }
    if (username === req.user!.username) {
      res.status(400).json({ error: "Kendi şifrenizi \"Şifremi değiştir\" ile değiştirin." });
      return;
    }
    if (!(await d.auth.setPassword(username, password as string))) {
      res.status(404).json({ error: "Kullanıcı bulunamadı." });
      return;
    }
    await kaydet(d.pool, req, "kullanici_sifre", { hedef: username });
    res.json({ ok: true });
  });

  r.post("/admin/kullanicilar/:username/oturumlari-kapat", async (req, res) => {
    const username = normalizeUsername(req.params.username);
    if (!(await d.auth.userExists(username))) {
      res.status(404).json({ error: "Kullanıcı bulunamadı." });
      return;
    }
    const n = await d.auth.destroyUserSessions(username);
    await kaydet(d.pool, req, "kullanici_oturum_kapat", { hedef: username, kapatilan: n });
    res.json({ kapatilan: n });
  });

  r.delete("/admin/kullanicilar/:username", async (req, res) => {
    const username = normalizeUsername(req.params.username);
    if (username === req.user!.username) {
      res.status(400).json({ error: "Kendi hesabınızı silemezsiniz." });
      return;
    }
    const sonuc = await kullaniciDegistir(d, username, { sil: true });
    if (sonuc === "yok") {
      res.status(404).json({ error: "Kullanıcı bulunamadı." });
      return;
    }
    if (sonuc) {
      res.status(409).json({ error: sonuc });
      return;
    }
    await kaydet(d.pool, req, "kullanici_sil", { hedef: username });
    res.json({ ok: true });
  });

  // ---------- İşlem kaydı ----------

  r.get("/admin/islemler", async (req, res) => {
    const q = islemSorgu.parse(req.query);
    const kosul: string[] = [];
    const p: unknown[] = [];
    if (q.kullanici) {
      p.push(normalizeUsername(q.kullanici));
      kosul.push(`kullanici = $${p.length}`);
    }
    if (q.islem) {
      p.push(q.islem);
      kosul.push(`islem = $${p.length}`);
    }
    if (q.once) {
      p.push(q.once);
      kosul.push(`id < $${p.length}`);
    }
    p.push(q.limit + 1);
    const rows = (
      await d.pool.query(
        // ORDER BY'da tablo adı şart: yalın "id" metne çevrilmiş takma adı sıralar ("9" > "10")
        `SELECT id::text AS id, zaman, kullanici, islem, detay, ip
           FROM islem_kaydi ${kosul.length ? "WHERE " + kosul.join(" AND ") : ""}
          ORDER BY islem_kaydi.id DESC LIMIT $${p.length}`,
        p,
      )
    ).rows;
    res.json({ items: rows.slice(0, q.limit), dahaVar: rows.length > q.limit });
  });

  // ---------- İstatistikler ----------

  r.get("/admin/istatistik", async (_req, res) => {
    const GUN = 30;
    const [ozet, gunluk, urunler, kullanicilar] = await Promise.all([
      d.pool.query(
        `SELECT (SELECT COUNT(*)::int FROM kunyeler) AS "toplamKunye",
                (SELECT COUNT(*)::int FROM evraklar) AS "toplamEvrak",
                (SELECT COUNT(*)::int FROM listeler) AS "toplamListe",
                (SELECT COUNT(*)::int FROM users WHERE aktif) AS "aktifKullanici",
                (SELECT COUNT(*)::int FROM kunyeler WHERE bildirim_ts >= now() - make_interval(days => $1)) AS "sonKunye",
                (SELECT COUNT(DISTINCT urun)::int FROM kunyeler WHERE bildirim_ts >= now() - make_interval(days => $1)) AS "sonUrunCesidi",
                (SELECT COUNT(*)::int FROM evraklar WHERE yukleme_zamani >= now() - make_interval(days => $1)) AS "sonEvrak"`,
        [GUN],
      ),
      // Son 30 gün (bugün dahil), Türkiye saatiyle: bildirilen künye ve yüklenen evrak sayısı
      d.pool.query(
        `WITH gunler AS (
           SELECT gs::date AS gun
             FROM generate_series((now() AT TIME ZONE 'Europe/Istanbul')::date - ($1::int - 1),
                                  (now() AT TIME ZONE 'Europe/Istanbul')::date, interval '1 day') gs
         )
         SELECT to_char(g.gun, 'YYYY-MM-DD') AS gun,
                (SELECT COUNT(*)::int FROM kunyeler k
                  WHERE (k.bildirim_ts AT TIME ZONE 'Europe/Istanbul')::date = g.gun) AS kunye,
                (SELECT COUNT(*)::int FROM evraklar e
                  WHERE (e.yukleme_zamani AT TIME ZONE 'Europe/Istanbul')::date = g.gun) AS evrak
           FROM gunler g ORDER BY g.gun`,
        [GUN],
      ),
      d.pool.query(
        `SELECT urun, COUNT(*)::int AS adet
           FROM kunyeler WHERE bildirim_ts >= now() - make_interval(days => $1)
          GROUP BY urun ORDER BY adet DESC, urun LIMIT 10`,
        [GUN],
      ),
      d.pool.query(
        `SELECT COALESCE(e.yukleyen, '(bilinmiyor)') AS kullanici, COUNT(DISTINCT e.id)::int AS evrak,
                COUNT(k.kunye_no)::int AS kunye
           FROM evraklar e LEFT JOIN kunyeler k ON k.evrak_id = e.id
          WHERE e.yukleme_zamani >= now() - make_interval(days => $1)
          GROUP BY 1 ORDER BY evrak DESC, kullanici`,
        [GUN],
      ),
    ]);
    res.json({
      gun: GUN,
      ozet: ozet.rows[0],
      gunluk: gunluk.rows,
      enCokUrun: urunler.rows,
      kullaniciYukleme: kullanicilar.rows,
    });
  });

  // ---------- Ayarlar ----------

  r.put("/admin/ayarlar", async (req, res) => {
    const b = ayarGuncelleSchema.safeParse(req.body ?? {});
    if (!b.success) {
      const i = b.error.issues[0];
      res.status(400).json({ error: "Geçersiz ayar" + (i?.path.length ? ` (${i.path.join(".")})` : "") + ": " + i?.message });
      return;
    }
    const eski = await ayarlariOku(d.pool);
    const yeni: Ayarlar = { ...eski, ...b.data };
    const terr = ayarTutarlilik(yeni);
    if (terr) {
      res.status(400).json({ error: terr });
      return;
    }
    const degisen = (Object.keys(b.data) as (keyof Ayarlar)[]).filter((k) => eski[k] !== yeni[k]);
    for (const k of degisen) {
      await d.pool.query(
        `INSERT INTO ayarlar (anahtar, deger, guncelleyen) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (anahtar) DO UPDATE SET deger = EXCLUDED.deger, guncelleyen = EXCLUDED.guncelleyen, guncelleme = now()`,
        [k, JSON.stringify(yeni[k]), req.user!.username],
      );
    }
    if (degisen.length) {
      await kaydet(d.pool, req, "ayar_degistir", Object.fromEntries(degisen.map((k) => [k, { eski: eski[k], yeni: yeni[k] }])));
    }
    res.json(yeni);
  });

  return r;
}
