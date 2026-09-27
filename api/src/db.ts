import { Pool } from "pg";

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}

// Basit, sıralı migrasyon sistemi. Yeni değişiklik = listeye yeni kayıt ekleyin (eskileri değiştirmeyin).
const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_init",
    sql: `
      CREATE TABLE users (
        id            SERIAL PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE sessions (
        id         TEXT PRIMARY KEY,               -- oturum belirtecinin SHA-256 özeti
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,                -- epoch ms
        last_seen  BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_expires ON sessions(expires_at);

      -- Yüklenen evrak (CSV/HTML/PDF). s3_key NULL ise orijinal dosya arşivlenmemiş (eski kayıt).
      CREATE TABLE evraklar (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ad             TEXT NOT NULL,
        mime           TEXT,
        boyut          BIGINT,
        sha256         TEXT,
        s3_key         TEXT,
        yukleyen       TEXT,
        yukleme_zamani TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX evraklar_sha256_uq ON evraklar(sha256) WHERE sha256 IS NOT NULL;

      CREATE TABLE kunyeler (
        kunye_no        TEXT PRIMARY KEY,
        urun            TEXT NOT NULL,
        tip             TEXT,
        bildirim_tarihi TEXT,                      -- Hal sisteminden geldiği gibi: "dd.mm.yyyy hh:mm:ss"
        bildirim_ts     TIMESTAMPTZ,               -- yukarıdakinin ayrıştırılmış hali (sıralama/temizlik için)
        uretim_yeri     TEXT,
        uretim_tarihi   TEXT,
        uretici_adi     TEXT,
        miktar          TEXT,
        fiyat           TEXT,
        kaynak_dosya    TEXT,
        evrak_id        UUID REFERENCES evraklar(id) ON DELETE CASCADE,
        yukleme_zamani  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_kunyeler_urun ON kunyeler(urun);
      CREATE INDEX idx_kunyeler_evrak ON kunyeler(evrak_id);
      CREATE INDEX idx_kunyeler_bildirim_ts ON kunyeler(bildirim_ts);
    `,
  },
  {
    id: "002_listeler",
    sql: `
      -- Önceden hazırlanıp kaydedilen yazdırma listeleri (örn. telefondan hazırlanıp bilgisayardan yazdırılır)
      CREATE TABLE listeler (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ad           TEXT NOT NULL,
        olusturan    TEXT,
        olusturma    TIMESTAMPTZ NOT NULL DEFAULT now(),
        guncelleme   TIMESTAMPTZ NOT NULL DEFAULT now(),
        son_yazdirma TIMESTAMPTZ
      );
      CREATE INDEX idx_listeler_guncelleme ON listeler(guncelleme DESC);

      -- Künye arşivden silinirse (evrak silme / 6 ay temizliği) listeden de düşer.
      CREATE TABLE liste_kunyeler (
        liste_id UUID NOT NULL REFERENCES listeler(id) ON DELETE CASCADE,
        kunye_no TEXT NOT NULL REFERENCES kunyeler(kunye_no) ON DELETE CASCADE,
        sira     INTEGER NOT NULL,
        PRIMARY KEY (liste_id, kunye_no)
      );
      CREATE INDEX idx_liste_kunyeler_kunye ON liste_kunyeler(kunye_no);
    `,
  },
  {
    id: "003_arama",
    sql: `
      -- Türkçe büyük/küçük harf ve i/ı/İ/I duyarsız arama anahtarı. upper() veritabanı yereline (locale) bağlı
      -- olduğu için kullanılmıyor; translate karakter karakter çalışır, her kurulumda aynı sonucu verir.
      CREATE FUNCTION tr_fold(t text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE
        AS $f$ SELECT translate(t, 'abcçdefgğhıijklmnoöprsştuüvyzqwxİâîûÂÎÛ', 'ABCÇDEFGĞHIIJKLMNOÖPRSŞTUÜVYZQWXIAIUAIU') $f$;
    `,
  },
  {
    id: "004_bekleyen_eksik",
    sql: `
      -- Aynı ürünün en yeni künyesini hızlı bulmak için (tazelik işaretleri)
      CREATE INDEX idx_kunyeler_urun_bildirim ON kunyeler(urun, bildirim_ts DESC);

      -- Listede künyesi henüz arşive gelmemiş ürün satırları ("DOMATES - künye bekleniyor").
      -- Sonradan yüklenen evraklardaki künyelerle eşleştirilir.
      CREATE TABLE liste_bekleyenler (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        liste_id  UUID NOT NULL REFERENCES listeler(id) ON DELETE CASCADE,
        urun      TEXT NOT NULL,
        aciklama  TEXT NOT NULL DEFAULT '',
        sira      INTEGER NOT NULL,
        olusturma TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_liste_bekleyenler_liste ON liste_bekleyenler(liste_id);

      -- "Bu gün alım yapılmadı" diye işaretlenen günler: eksik evrak uyarısında gösterilmez.
      CREATE TABLE eksik_gun_muaf (
        gun         DATE PRIMARY KEY,
        isaretleyen TEXT,
        zaman       TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    id: "005_yonetim",
    sql: `
      -- Roller: yonetici her şeyi yapar; personel yükler, arar, listeler, yazdırır (silme/bakım/yönetim yok).
      ALTER TABLE users ADD COLUMN rol TEXT NOT NULL DEFAULT 'personel' CHECK (rol IN ('yonetici', 'personel'));
      ALTER TABLE users ADD COLUMN aktif BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE users ADD COLUMN son_giris TIMESTAMPTZ;
      -- Mevcut kurulumda ilk oluşturulan kullanıcı (ADMIN_USERNAME) yönetici olur, diğerleri personel.
      UPDATE users SET rol = 'yonetici' WHERE id = (SELECT min(id) FROM users);

      -- Kim, ne zaman, ne yaptı. Kullanıcı silinse de kayıt kalır (ad metin olarak tutulur).
      CREATE TABLE islem_kaydi (
        id        BIGSERIAL PRIMARY KEY,
        zaman     TIMESTAMPTZ NOT NULL DEFAULT now(),
        kullanici TEXT,
        islem     TEXT NOT NULL,
        detay     JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip        TEXT
      );
      CREATE INDEX idx_islem_kaydi_zaman ON islem_kaydi(zaman DESC);
      CREATE INDEX idx_islem_kaydi_kullanici ON islem_kaydi(kullanici, id DESC);
      CREATE INDEX idx_islem_kaydi_islem ON islem_kaydi(islem, id DESC);

      -- Panelden değiştirilebilen ayarlar (tanımsız anahtar = varsayılan değer, bkz. ayarlar.ts)
      CREATE TABLE ayarlar (
        anahtar     TEXT PRIMARY KEY,
        deger       JSONB NOT NULL,
        guncelleyen TEXT,
        guncelleme  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
];

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query("SELECT id FROM schema_migrations")).rows.map((r) => r.id as string));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
        await client.query("COMMIT");
        console.log(`Migrasyon uygulandı: ${m.id}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => {});
    client.release();
  }
}
