import { describe, expect, it } from "vitest";
import { linesToRecords } from "./parser";
import { parseTRDateTime, trUpper } from "./tr";

const FOOT = [
  "Gümrük ve Ticaret Bakanlığı Hal Kayıt Sisteminden",
  "alınan künye bilgilerini www.hal.gov.tr adresinden",
  "künye numarası ile sorgulayabilirsiniz.",
];

describe("linesToRecords", () => {
  it("tek künyeyi ayrıştırır, fiyata ₺ ekler ve sondaki ? işaretini atar", () => {
    const r = linesToRecords([
      "DOMATES;", "SALKIM;", ";1234567890;",
      "Bildirim Tarihi : 12.03.2026 14:22:10",
      "Üretim Yeri : ANTALYA/KUMLUCA",
      "Üretim Tarihi : 10.03.2026;",
      "Üreticisinin Adı : AHMET YILMAZ",
      "Miktar : 100 KG",
      "Alış Fiyatı : 25,50?",
      ...FOOT,
    ]);
    expect(r).toEqual([
      {
        urun: "DOMATES", tip: "SALKIM", kunyeNo: "1234567890",
        bildirimTarihi: "12.03.2026 14:22:10", uretimYeri: "ANTALYA/KUMLUCA", uretimTarihi: "10.03.2026",
        ureticiAdi: "AHMET YILMAZ", miktar: "100 KG", fiyat: "25,50 ₺",
      },
    ]);
  });

  it("Hal sisteminin 25 karakterde böldüğü Üretim Yeri'ni kelime ortasından birleştirir", () => {
    const r = linesToRecords([
      "KARPUZ", "X", "1234567892",
      "Üretim Yeri : İSTANBUL/ARNAVUTKÖY/MERKE", "Z KÖYLER",
      "Alış Fiyatı : 8", ...FOOT,
    ]);
    expect(r[0]?.uretimYeri).toBe("İSTANBUL/ARNAVUTKÖY/MERKEZ KÖYLER");
  });

  it("ayrı satırdaki KÖYLER gerçek bir sözcüktür: boşluk kalır", () => {
    const r = linesToRecords(["KARPUZ", "X", "1234567893", "Üretim Yeri : BURSA/NİLÜFER", "KÖYLER", "Alış Fiyatı : 8", ...FOOT]);
    expect(r[0]?.uretimYeri).toBe("BURSA/NİLÜFER KÖYLER");
  });

  it("birden fazla künyeyi ayırır", () => {
    const blk = (u: string, no: string) => [u, "T", no, "Alış Fiyatı : 1", ...FOOT];
    expect(linesToRecords([...blk("A", "1111111111"), ...blk("B", "2222222222")]).map((x) => x.urun)).toEqual(["A", "B"]);
  });

  it("dipnotsuz son kayıt sadece fiyatı varsa alınır", () => {
    expect(linesToRecords(["SON", "Y", "1234567895", "Alış Fiyatı : 5"])).toHaveLength(1);
    expect(linesToRecords(["SON", "Y", "1234567896", "Miktar : 5 KG"])).toHaveLength(0);
  });

  it("boş girdi ve gürültüde kayıt üretmez", () => {
    expect(linesToRecords([])).toEqual([]);
    expect(linesToRecords(["", "  ", "\u00A0", ";"])).toEqual([]);
  });
});

describe("tr yardımcıları", () => {
  it("trUpper Türkçe i/ı dönüşümünü yapar", () => {
    expect(trUpper("limon")).toBe("LİMON");
    expect(trUpper("şeftali")).toBe("ŞEFTALİ");
    expect(trUpper("ısırgan")).toBe("ISIRGAN");
  });
  it("parseTRDateTime", () => {
    expect(parseTRDateTime("12.03.2026 14:22:10")).toBeGreaterThan(parseTRDateTime("01.01.2020 10:00:00"));
    expect(parseTRDateTime("")).toBe(0);
    expect(parseTRDateTime("x")).toBe(0);
  });
});
