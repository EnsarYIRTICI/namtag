import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "./db";
import { evrakForm, type Harness, kunye, ORIGIN, startHarness } from "./test/harness";

const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)("API + PostgreSQL", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness(DB!);
  });
  afterAll(async () => {
    await h?.close();
  });

  const upload = async (ad: string, recs: unknown[], content?: string) =>
    (await h.call("POST", "/evraklar", evrakForm(ad, recs, content))).data;

  describe("güvenlik", () => {
    it("oturumsuz istek 401", async () => {
      const r = await fetch(h.base + "/kunyeler/ozet");
      expect(r.status).toBe(401);
    });
    it("yabancı Origin ile durum değiştiren istek 403", async () => {
      const r = await h.call("POST", "/listeler", { ad: "x", kunyeNos: [] }, { origin: "https://kotu.example" });
      expect(r.status).toBe(403);
    });
    it("migrasyon ikinci kez çalışınca hata vermez", async () => {
      await expect(migrate(h.pool)).resolves.toBeUndefined();
    });
  });

  describe("evrak yükleme", () => {
    it("künyeleri ekler, orijinal dosyayı saklar ve indirilebilir", async () => {
      const recs = [kunye("DOMATES", "20.09.2026 07:00:00"), kunye("BİBER SİVRİ", "21.09.2026 07:00:00")];
      const r = await upload("a.pdf", recs, "%PDF-1.4 dosya-a");
      expect(r).toMatchObject({ added: 2, skipped: 0, duplicate: false });
      expect(h.store.objects.size).toBe(1);

      const dl = await h.call("GET", `/evraklar/${r.evrakId}/dosya`);
      expect(dl.status).toBe(200);
      expect(dl.data).toBe("%PDF-1.4 dosya-a");
    });

    it("aynı dosya ikinci kez yüklenince hiçbir şey eklenmez", async () => {
      const r = await upload("a-kopya.pdf", [kunye("MUZ", "21.09.2026 07:00:00")], "%PDF-1.4 dosya-a");
      expect(r).toMatchObject({ added: 0, duplicate: true });
    });

    it("zaten arşivde olan künyeler atlanır, yeniler eklenir; geçersizler sayılır", async () => {
      const eski = kunye("HAVUÇ", "19.09.2026 07:00:00");
      await upload("b.pdf", [eski]);
      const yeni = kunye("KABAK", "19.09.2026 08:00:00");
      const r = await upload("c.pdf", [eski, yeni, { kunyeNo: "12", urun: "X" }]);
      expect(r).toMatchObject({ added: 1, skipped: 1, invalid: 1 });
      expect(r.skippedNos).toEqual([eski.kunyeNo]);
    });

    it("PDF olmayan içerik .pdf adıyla reddedilir", async () => {
      const r = await h.call("POST", "/evraklar", evrakForm("sahte.pdf", [kunye("X", "")], "merhaba"));
      expect(r.status).toBe(400);
    });
  });

  describe("arama", () => {
    beforeAll(async () => {
      await upload("arama.pdf", [
        kunye("BİBER ÇARLİSTON", "22.09.2026 06:00:00"),
        kunye("DOMATES", "23.09.2026 06:00:00"),
        kunye("DOMATES", "10.09.2026 06:00:00"),
        kunye("ISPANAK", "22.09.2026 06:00:00"),
        kunye("DOMATES", ""), // tarihi okunamayan en sona
      ]);
    });

    it("Türkçe harf ve büyük/küçük harf duyarsız", async () => {
      for (const q of ["çarliston", "ÇARLİSTON", "carlıston".replace("c", "ç"), "biber ç"]) {
        const r = await h.call("GET", "/kunyeler?q=" + encodeURIComponent(q));
        expect(r.data.items.map((k: any) => k.urun), q).toContain("BİBER ÇARLİSTON");
      }
      // i/ı/İ/I birbirine denk: "ıspanak" da "ispanak" da bulur
      for (const q of ["ıspanak", "ispanak", "Ispanak"]) {
        expect((await h.call("GET", "/kunyeler?q=" + encodeURIComponent(q))).data.toplam, q).toBe(1);
      }
    });

    it("en yeni bildirim önce, tarihsiz en sonda; toplam limit'ten bağımsız", async () => {
      const r = await h.call("GET", "/kunyeler?q=domates&limit=50");
      const tarihler = r.data.items.map((k: any) => k.bildirimTarihi);
      expect(tarihler[0]).toBe("23.09.2026 06:00:00");
      expect(tarihler.at(-1)).toBe("");
      const r2 = await h.call("GET", "/kunyeler?q=domates&limit=1");
      expect(r2.data.items).toHaveLength(1);
      expect(r2.data.toplam).toBe(r.data.toplam);
    });

    it("boş sorgu boş sonuç, geçersiz limit varsayılana düşer, LIKE jokerleri düz metin", async () => {
      expect((await h.call("GET", "/kunyeler?q=%20%20")).data).toEqual({ items: [], toplam: 0 });
      expect((await h.call("GET", "/kunyeler?q=d&limit=abc")).status).toBe(200);
      expect((await h.call("GET", "/kunyeler?q=" + encodeURIComponent("%"))).data.toplam).toBe(0);
      expect((await h.call("GET", "/kunyeler?q=" + encodeURIComponent("_"))).data.toplam).toBe(0);
    });

    it("özet toplam künye sayısını verir", async () => {
      const r = await h.call("GET", "/kunyeler/ozet");
      const say = (await h.pool.query("SELECT COUNT(*)::int n FROM kunyeler")).rows[0].n;
      expect(r.data.toplam).toBe(say);
    });

    it("bul: istenen sırayla döner, arşivde olmayanı atlar", async () => {
      const [a, b] = (await h.call("GET", "/kunyeler?q=domates&limit=2")).data.items;
      const r = await h.call("POST", "/kunyeler/bul", { kunyeNos: [b.kunyeNo, "99999999999", a.kunyeNo] });
      expect(r.data.map((k: any) => k.kunyeNo)).toEqual([b.kunyeNo, a.kunyeNo]);
    });
  });

  describe("kayıtlı listeler", () => {
    it("oluştur, güncelle, yazdırıldı işaretle, sil", async () => {
      const recs = [kunye("ELMA", "23.09.2026 05:00:00"), kunye("ARMUT", "23.09.2026 05:00:00")];
      await upload("liste.pdf", recs);
      const nos = recs.map((r) => r.kunyeNo);

      const c = await h.call("POST", "/listeler", { ad: "  Tezgah ", kunyeNos: [nos[1], "99999999999", nos[0], nos[1]] });
      expect(c.status).toBe(201);
      expect(c.data).toMatchObject({ ad: "Tezgah", olusturan: "tester", sonYazdirma: null, kunyeNos: [nos[1], nos[0]] });

      const u = await h.call("PUT", `/listeler/${c.data.id}`, { ad: "Tezgah 2", kunyeNos: [nos[0]] });
      expect(u.data).toMatchObject({ ad: "Tezgah 2", kunyeNos: [nos[0]] });

      const p = await h.call("POST", `/listeler/${c.data.id}/yazdirildi`);
      expect(p.data.sonYazdirma).not.toBeNull();

      expect((await h.call("DELETE", `/listeler/${c.data.id}`)).status).toBe(200);
      expect((await h.call("DELETE", `/listeler/${c.data.id}`)).status).toBe(404);
    });

    it("hiçbiri arşivde olmayan liste ve boş ad reddedilir", async () => {
      expect((await h.call("POST", "/listeler", { ad: "x", kunyeNos: ["99999999999"] })).status).toBe(400);
      expect((await h.call("POST", "/listeler", { ad: " ", kunyeNos: ["99999999999"] })).status).toBe(400);
      expect((await h.call("PUT", "/listeler/00000000-0000-0000-0000-000000000000", { ad: "x", kunyeNos: ["99999999999"] })).status).toBe(404);
      expect((await h.call("PUT", "/listeler/bozuk", { ad: "x", kunyeNos: ["99999999999"] })).status).toBe(400);
    });

    it("evrak silinince künyeleri listelerden düşer, liste kalır", async () => {
      const k1 = kunye("NAR", "23.09.2026 05:00:00");
      const k2 = kunye("AYVA", "23.09.2026 05:00:00");
      const e1 = await upload("sil1.pdf", [k1]);
      await upload("sil2.pdf", [k2]);
      const l = (await h.call("POST", "/listeler", { ad: "Karışık", kunyeNos: [k1.kunyeNo, k2.kunyeNo] })).data;

      const del = await h.call("DELETE", `/evraklar/${e1.evrakId}`);
      expect(del.data).toEqual({ deleted: 1 });
      expect(h.store.objects.has(`evraklar/${e1.evrakId}`)).toBe(false);

      const lists = (await h.call("GET", "/listeler")).data as any[];
      expect(lists.find((x) => x.id === l.id).kunyeNos).toEqual([k2.kunyeNo]);
    });
  });

  describe("bakım", () => {
    it("eski künyeleri siler, künyesiz kalan evrağı ve dosyasını temizler", async () => {
      const eski = kunye("ESKİ ÜRÜN", "01.01.2025 07:00:00");
      const e = await upload("eski.pdf", [eski]);
      expect(h.store.objects.has(`evraklar/${e.evrakId}`)).toBe(true);

      const r = await h.call("POST", "/kunyeler/cleanup", { days: 180 });
      expect(r.data.deleted).toBeGreaterThanOrEqual(1);
      expect((await h.call("GET", "/kunyeler?q=eski ürün")).data.toplam).toBe(0);
      expect(h.store.objects.has(`evraklar/${e.evrakId}`)).toBe(false);
      const ev = (await h.call("GET", "/evraklar")).data as any[];
      expect(ev.some((x) => x.id === e.evrakId)).toBe(false);
    });
  });
});

// Bu dosya TEST_DATABASE_URL yokken sessizce atlanır; bunu görünür kıl.
if (!DB) console.warn("[api.integration.test] TEST_DATABASE_URL yok: veritabanı testleri atlandı.");
void ORIGIN;
