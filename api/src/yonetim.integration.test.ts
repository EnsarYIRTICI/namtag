import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evrakForm, halTarihi, type Harness, kunye, startHarness } from "./test/harness";

const DB = process.env.TEST_DATABASE_URL;
const SIFRE = "personel-sifre-123";

describe.skipIf(!DB)("yönetim paneli", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness(DB!);
  });
  afterAll(async () => {
    await h?.close();
  });

  async function personelEkle(username: string, rol: "personel" | "yonetici" = "personel") {
    const r = await h.call("POST", "/admin/kullanicilar", { username, password: SIFRE, rol });
    expect(r.status).toBe(201);
    return h.loginAs(username, SIFRE);
  }

  describe("roller ve yetki", () => {
    it("/me rolü döner", async () => {
      expect((await h.call("GET", "/me")).data.rol).toBe("yonetici");
    });

    it("personel yönetim uçlarına, evrak/künye silmeye ve temizliğe erişemez", async () => {
      const p = await personelEkle("per1");
      expect((await p("GET", "/me")).data.rol).toBe("personel");
      for (const [m, path] of [
        ["GET", "/admin/kullanicilar"],
        ["GET", "/admin/islemler"],
        ["GET", "/admin/istatistik"],
        ["PUT", "/admin/ayarlar"],
        ["POST", "/kunyeler/cleanup"],
        ["DELETE", "/kunyeler/123456789"],
        ["DELETE", "/evraklar/00000000-0000-0000-0000-000000000000"],
      ] as const) {
        expect((await p(m, path, m === "GET" || m === "DELETE" ? undefined : {})).status, `${m} ${path}`).toBe(403);
      }
    });

    it("personel yükleyebilir, arayabilir ve ayarları okuyabilir", async () => {
      const p = await h.loginAs("per1", SIFRE);
      const up = await p("POST", "/evraklar", evrakForm("per1.pdf", [kunye("PERSONEL ÜRÜN", halTarihi(1))]));
      expect(up.status).toBe(200);
      expect(up.data.added).toBe(1);
      expect((await p("GET", "/kunyeler?q=personel ürün")).data.toplam).toBe(1);
      expect((await p("GET", "/ayarlar")).data.tazelikEskiGun).toBe(15);
    });
  });

  describe("kullanıcı işlemleri", () => {
    it("geçersiz ve tekrar eden kullanıcı adını reddeder", async () => {
      expect((await h.call("POST", "/admin/kullanicilar", { username: "A B", password: SIFRE })).status).toBe(400);
      expect((await h.call("POST", "/admin/kullanicilar", { username: "kisa-sifre", password: "123" })).status).toBe(400);
      expect((await h.call("POST", "/admin/kullanicilar", { username: "per1", password: SIFRE })).status).toBe(409);
    });

    it("listede rol, durum ve açık oturum sayısı görünür", async () => {
      const list = (await h.call("GET", "/admin/kullanicilar")).data as any[];
      const per1 = list.find((u) => u.username === "per1");
      expect(per1).toMatchObject({ rol: "personel", aktif: true });
      expect(per1.acikOturum).toBeGreaterThanOrEqual(1);
      expect(per1.sonGiris).toBeTruthy();
    });

    it("pasifleştirilen kullanıcının oturumu düşer ve giriş yapamaz; aktifleşince girer", async () => {
      const p = await personelEkle("per2");
      expect((await p("GET", "/me")).status).toBe(200);
      expect((await h.call("PATCH", "/admin/kullanicilar/per2", { aktif: false })).status).toBe(200);
      expect((await p("GET", "/me")).status).toBe(401);
      const giris = await fetch(h.base + "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "per2", password: SIFRE }),
      });
      expect(giris.status).toBe(403);
      expect((await giris.json()).error).toMatch(/pasif/);
      expect((await h.call("PATCH", "/admin/kullanicilar/per2", { aktif: true })).status).toBe(200);
      await expect(h.loginAs("per2", SIFRE)).resolves.toBeTypeOf("function");
    });

    it("rol değişikliği anında geçerli olur", async () => {
      const p = await h.loginAs("per2", SIFRE);
      expect((await p("GET", "/admin/kullanicilar")).status).toBe(403);
      await h.call("PATCH", "/admin/kullanicilar/per2", { rol: "yonetici" });
      expect((await p("GET", "/admin/kullanicilar")).status).toBe(200);
      await h.call("PATCH", "/admin/kullanicilar/per2", { rol: "personel" });
      expect((await p("GET", "/admin/kullanicilar")).status).toBe(403);
    });

    it("yönetici şifre sıfırlayınca kullanıcının oturumları kapanır", async () => {
      const p = await h.loginAs("per2", SIFRE);
      expect((await h.call("POST", "/admin/kullanicilar/per2/sifre", { password: "yeni-sifre-4567" })).status).toBe(200);
      expect((await p("GET", "/me")).status).toBe(401);
      await expect(h.loginAs("per2", "yeni-sifre-4567")).resolves.toBeTypeOf("function");
    });

    it("oturumları kapat", async () => {
      const p = await h.loginAs("per1", SIFRE);
      const r = await h.call("POST", "/admin/kullanicilar/per1/oturumlari-kapat");
      expect(r.data.kapatilan).toBeGreaterThanOrEqual(1);
      expect((await p("GET", "/me")).status).toBe(401);
    });

    it("kendi rolünü/durumunu değiştiremez, kendini silemez", async () => {
      expect((await h.call("PATCH", "/admin/kullanicilar/tester", { rol: "personel" })).status).toBe(400);
      expect((await h.call("PATCH", "/admin/kullanicilar/tester", { aktif: false })).status).toBe(400);
      expect((await h.call("DELETE", "/admin/kullanicilar/tester")).status).toBe(400);
    });

    it("yetkisi alınan yönetici hemen engellenir, yönetici sayısı korunur", async () => {
      const y2 = await personelEkle("yon2", "yonetici");
      // yon2, tester'ı personel yapabilir (yon2 yönetici kalıyor)...
      expect((await y2("PATCH", "/admin/kullanicilar/tester", { rol: "personel" })).status).toBe(200);
      // ...ama tester artık yönetici değil; yon2'yi düşürecek aktif yönetici kalmadı
      expect((await h.call("PATCH", "/admin/kullanicilar/yon2", { rol: "personel" })).status).toBe(403);
      // tester'ı geri yönetici yap, sonra yon2 silinebilir
      expect((await y2("PATCH", "/admin/kullanicilar/tester", { rol: "yonetici" })).status).toBe(200);
      expect((await h.call("DELETE", "/admin/kullanicilar/yon2")).status).toBe(200);
      // tek yönetici tester: başka yönetici onu düşüremez (kendisi de değiştiremez)
      const list = (await h.call("GET", "/admin/kullanicilar")).data as any[];
      expect(list.filter((u) => u.rol === "yonetici" && u.aktif).map((u) => u.username)).toEqual(["tester"]);
    });

    it("olmayan kullanıcı 404", async () => {
      expect((await h.call("PATCH", "/admin/kullanicilar/yok-boyle", { aktif: false })).status).toBe(404);
      expect((await h.call("DELETE", "/admin/kullanicilar/yok-boyle")).status).toBe(404);
      expect((await h.call("POST", "/admin/kullanicilar/yok-boyle/sifre", { password: SIFRE })).status).toBe(404);
    });
  });

  describe("şifremi değiştir", () => {
    it("mevcut şifre doğrulanır, diğer oturumlar kapanır, bu oturum devam eder", async () => {
      await personelEkle("per3");
      const diger = await h.loginAs("per3", SIFRE);
      const cookie = await h.login("per3", SIFRE);
      const res = await fetch(h.base + "/me/sifre", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ mevcut: "yanlis-sifre-000", yeni: "yepyeni-sifre-99" }),
      });
      expect(res.status).toBe(400);
      const ok = await fetch(h.base + "/me/sifre", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ mevcut: SIFRE, yeni: "yepyeni-sifre-99" }),
      });
      expect(ok.status).toBe(200);
      const yeniCookie = (ok.headers.get("set-cookie") ?? "").split(";")[0]!;
      expect((await fetch(h.base + "/me", { headers: { cookie: yeniCookie } })).status).toBe(200);
      expect((await diger("GET", "/me")).status).toBe(401);
      await expect(h.loginAs("per3", "yepyeni-sifre-99")).resolves.toBeTypeOf("function");
    });
  });

  describe("ayarlar", () => {
    it("varsayılanlar döner, güncellenir, tutarsız değer reddedilir", async () => {
      expect((await h.call("GET", "/ayarlar")).data).toEqual({
        eksikGunPenceresi: 30,
        tazelikEskiGun: 15,
        tazelikCokEskiGun: 30,
        temizlikGun: 180,
      });
      expect((await h.call("PUT", "/admin/ayarlar", { tazelikEskiGun: 40 })).status).toBe(400); // kırmızı eşikten büyük
      expect((await h.call("PUT", "/admin/ayarlar", { bilinmeyen: 1 })).status).toBe(400);
      expect((await h.call("PUT", "/admin/ayarlar", { eksikGunPenceresi: 3 })).status).toBe(400);
      const r = await h.call("PUT", "/admin/ayarlar", { eksikGunPenceresi: 14, tazelikEskiGun: 10 });
      expect(r.status).toBe(200);
      expect(r.data).toMatchObject({ eksikGunPenceresi: 14, tazelikEskiGun: 10, tazelikCokEskiGun: 30 });
      expect((await h.call("GET", "/eksikler")).data.pencereGun).toBe(14);
    });

    it("temizlik gün verilmezse ayardaki değeri kullanır", async () => {
      await h.call("PUT", "/admin/ayarlar", { temizlikGun: 60 });
      await h.call("POST", "/evraklar", evrakForm("eski.pdf", [kunye("ÇOK ESKİ", halTarihi(90))]));
      const r = await h.call("POST", "/kunyeler/cleanup", {});
      expect(r.data.days).toBe(60);
      expect(r.data.deleted).toBeGreaterThanOrEqual(1);
    });
  });

  describe("işlem kaydı ve istatistik", () => {
    it("işlemler kaydedilir ve filtrelenir", async () => {
      const tum = (await h.call("GET", "/admin/islemler?limit=200")).data.items as any[];
      const islemler = new Set(tum.map((x) => x.islem));
      for (const i of ["giris", "evrak_yukle", "kullanici_ekle", "kullanici_aktif", "kullanici_rol", "kullanici_sil",
        "kullanici_sifre", "kullanici_oturum_kapat", "sifre_degistir", "ayar_degistir", "temizlik", "giris_hatali"]) {
        expect(islemler.has(i), i).toBe(true);
      }
      const yukleme = tum.find((x) => x.islem === "evrak_yukle" && x.kullanici === "per1");
      expect(yukleme.detay).toMatchObject({ ad: "per1.pdf", eklenen: 1 });

      const sadece = (await h.call("GET", "/admin/islemler?kullanici=per1&islem=evrak_yukle")).data.items as any[];
      expect(sadece.length).toBe(1);
    });

    it("en yeni kayıt önce (id sayısal sıralanır, metin değil)", async () => {
      const ids = ((await h.call("GET", "/admin/islemler?limit=200")).data.items as any[]).map((x) => Number(x.id));
      expect(ids.length).toBeGreaterThan(10); // 9 ve 10 gibi basamak sayısı farklı id'ler olsun
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
    });

    it("sayfalama: once ile daha eski kayıtlar", async () => {
      const s1 = (await h.call("GET", "/admin/islemler?limit=3")).data;
      expect(s1.items.length).toBe(3);
      expect(s1.dahaVar).toBe(true);
      const s2 = (await h.call("GET", `/admin/islemler?limit=3&once=${s1.items[2].id}`)).data;
      expect(Number(s2.items[0].id)).toBeLessThan(Number(s1.items[2].id));
    });

    it("istatistik: özet, 30 günlük seri, en çok ürün, kullanıcı yüklemeleri", async () => {
      await h.call("POST", "/evraklar", evrakForm("ist.pdf", [kunye("İST ELMA", halTarihi(2)), kunye("İST ELMA", halTarihi(2))]));
      const s = (await h.call("GET", "/admin/istatistik")).data;
      expect(s.gunluk).toHaveLength(30);
      expect(s.ozet.toplamKunye).toBeGreaterThanOrEqual(3);
      expect(s.enCokUrun[0]).toEqual({ urun: "İST ELMA", adet: 2 });
      expect(s.kullaniciYukleme.map((x: any) => x.kullanici)).toEqual(expect.arrayContaining(["tester", "per1"]));
      const gun2 = s.gunluk[s.gunluk.length - 3];
      expect(gun2.kunye).toBeGreaterThanOrEqual(2);
    });
  });
});
