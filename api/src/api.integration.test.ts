import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "./db";
import { evrakForm, halTarihi, type Harness, isoGun, kunye, ORIGIN, startHarness } from "./test/harness";

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

  describe("tazelik işaretleri", () => {
    it("aynı ürünün en yenisi işaretlenir, eskisinde daha yeni tarih ve yaş gelir", async () => {
      const yeni = kunye("KARPUZ", halTarihi(1));
      const eski = kunye("KARPUZ", halTarihi(40));
      const baska = kunye("KARPUZ DİLİM", halTarihi(60)); // farklı ürün adı: kendi grubunun en yenisi
      await upload("tazelik.pdf", [yeni, eski, baska]);

      const r = await h.call("GET", "/kunyeler?q=karpuz");
      const by = Object.fromEntries(r.data.items.map((k: any) => [k.kunyeNo, k]));
      expect(by[yeni.kunyeNo]).toMatchObject({ enYeni: true, dahaYeni: null, yasGun: 1 });
      expect(by[eski.kunyeNo]).toMatchObject({ enYeni: false, dahaYeni: yeni.bildirimTarihi, yasGun: 40 });
      expect(by[baska.kunyeNo]).toMatchObject({ enYeni: true, yasGun: 60 });

      const b = await h.call("POST", "/kunyeler/bul", { kunyeNos: [eski.kunyeNo] });
      expect(b.data[0]).toMatchObject({ enYeni: false, dahaYeni: yeni.bildirimTarihi });
    });

    it("tarihi okunamayan künye en yeni sayılmaz, yaşı null", async () => {
      const k = kunye("TARİHSİZ ÜRÜN", "");
      await upload("tarihsiz.pdf", [k]);
      const r = await h.call("GET", "/kunyeler?q=tarihsiz");
      expect(r.data.items[0]).toMatchObject({ enYeni: false, yasGun: null });
    });
  });

  describe("bekleyen ürünler", () => {
    it("sadece bekleyen ürünle liste kaydedilir; sonradan gelen künyeler aday olur, eskiler olmaz", async () => {
      const oncedenVar = kunye("PANCAR", halTarihi(2));
      await upload("pancar-eski.pdf", [oncedenVar]);

      const c = await h.call("POST", "/listeler", {
        ad: "Manavda not",
        kunyeNos: [],
        bekleyenler: [{ urun: "pancar", aciklama: "rafta etiketi yok" }, { urun: "şalgam" }, { urun: "turp" }],
      });
      expect(c.status).toBe(201);
      expect(c.data.kunyeNos).toEqual([]);
      expect(c.data.bekleyenler.map((b: any) => [b.urun, b.adaylar.length])).toEqual([
        ["pancar", 0], // önceden arşivde olan önerilmez
        ["şalgam", 0],
        ["turp", 0],
      ]);

      await new Promise((r) => setTimeout(r, 20)); // yükleme zamanı kesin sonra olsun
      const s1 = kunye("ŞALGAM", halTarihi(0, 6));
      const t1 = kunye("TURP BEYAZ", halTarihi(0, 6));
      const t2 = kunye("TURP KIRMIZI", halTarihi(0, 5));
      const p2 = kunye("PANCAR", halTarihi(0, 6));
      await upload("sabah.pdf", [s1, t1, t2, p2]);

      const l = (await h.call("GET", "/listeler")).data.find((x: any) => x.id === c.data.id);
      const ad = Object.fromEntries(l.bekleyenler.map((b: any) => [b.urun, b.adaylar.map((a: any) => a.kunyeNo)]));
      expect(ad["pancar"]).toEqual([p2.kunyeNo]);
      expect(ad["şalgam"]).toEqual([s1.kunyeNo]); // "şalgam" -> "ŞALGAM"
      expect(ad["turp"]).toEqual([t1.kunyeNo, t2.kunyeNo]); // iki farklı ürün: kullanıcı seçer, en yenisi önce
    });

    it("güncellemede id'li satır korunur (eklenme zamanı değişmez), gönderilmeyen satır silinir", async () => {
      const c = (await h.call("POST", "/listeler", { ad: "Koru", kunyeNos: [], bekleyenler: [{ urun: "ayva" }, { urun: "nar" }] })).data;
      const [ayva] = c.bekleyenler;
      const u = await h.call("PUT", `/listeler/${c.id}`, {
        ad: "Koru",
        kunyeNos: [],
        bekleyenler: [{ id: ayva.id, urun: "ayva", aciklama: "sarı" }, { urun: "hurma" }],
      });
      expect(u.data.bekleyenler.map((b: any) => b.urun)).toEqual(["ayva", "hurma"]);
      expect(u.data.bekleyenler[0]).toMatchObject({ id: ayva.id, olusturma: ayva.olusturma, aciklama: "sarı" });

      // başka listenin satır id'si bu listeye taşınamaz: yeni satır olarak eklenir
      const diger = (await h.call("POST", "/listeler", { ad: "Diğer", kunyeNos: [], bekleyenler: [{ urun: "kivi" }] })).data;
      const u2 = await h.call("PUT", `/listeler/${c.id}`, { ad: "Koru", kunyeNos: [], bekleyenler: [{ id: diger.bekleyenler[0].id, urun: "kivi" }] });
      expect(u2.data.bekleyenler[0].id).not.toBe(diger.bekleyenler[0].id);
      const d2 = (await h.call("GET", "/listeler")).data.find((x: any) => x.id === diger.id);
      expect(d2.bekleyenler).toHaveLength(1);
    });

    it("ne künye ne bekleyen olan liste reddedilir", async () => {
      const r = await h.call("POST", "/listeler", { ad: "Boş", kunyeNos: [], bekleyenler: [] });
      expect(r.status).toBe(400);
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

// Eksik gün hesabı arşivin tamamına baktığı için diğer testlerin verisinden etkilenmesin: ayrı şema.
describe.skipIf(!DB)("eksik evrak günleri", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness(DB!);
  });
  afterAll(async () => {
    await h?.close();
  });
  const upload = async (ad: string, recs: unknown[]) => (await h.call("POST", "/evraklar", evrakForm(ad, recs))).data;

  it("arşiv boşken uyarı yok", async () => {
    expect((await h.call("GET", "/eksikler")).data).toMatchObject({ eksik: [], muaf: [] });
  });

  it("ilk künyeden itibaren, bugün hariç, künyesi olmayan günleri bildirir; alım yok işareti gizler ve geri alınır", async () => {
    // 10 gün önce başlamış, 7 ve 3 gün önce ile dün evrak yüklenmemiş
    const gunler = [10, 9, 8, 6, 5, 4, 2];
    await upload("gecmis.pdf", gunler.map((g) => kunye("DOMATES", halTarihi(g))));
    await upload("bugun.pdf", [kunye("DOMATES", halTarihi(0))]);

    let r = (await h.call("GET", "/eksikler")).data;
    expect(r.eksik).toEqual([isoGun(1), isoGun(3), isoGun(7)]);

    expect((await h.call("POST", "/eksikler/muaf", { gun: isoGun(3) })).status).toBe(200);
    r = (await h.call("GET", "/eksikler")).data;
    expect(r.eksik).toEqual([isoGun(1), isoGun(7)]);
    expect(r.muaf).toEqual([{ gun: isoGun(3), isaretleyen: "tester" }]);

    expect((await h.call("DELETE", `/eksikler/muaf/${isoGun(3)}`)).status).toBe(200);
    expect((await h.call("GET", "/eksikler")).data.eksik).toContain(isoGun(3));
  });

  it("30 günden eski boşluklar bildirilmez", async () => {
    await upload("cok-eski.pdf", [kunye("ELMA", halTarihi(45))]);
    const r = (await h.call("GET", "/eksikler")).data;
    expect(r.eksik.length).toBeLessThanOrEqual(30);
    expect(r.eksik).not.toContain(isoGun(31));
    expect(r.eksik).toContain(isoGun(30));
  });

  it("geçersiz tarih reddedilir", async () => {
    expect((await h.call("POST", "/eksikler/muaf", { gun: "2026-02-31" })).status).toBe(400);
    expect((await h.call("POST", "/eksikler/muaf", { gun: "dün" })).status).toBe(400);
    expect((await h.call("DELETE", "/eksikler/muaf/abc")).status).toBe(400);
  });
});

// Bu dosya TEST_DATABASE_URL yokken sessizce atlanır; bunu görünür kıl.
if (!DB) console.warn("[api.integration.test] TEST_DATABASE_URL yok: veritabanı testleri atlandı.");
void ORIGIN;
