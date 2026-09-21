import { describe, expect, it } from "vitest";
import { normalizeRecord } from "./routes/evraklar";
import { parseBildirimTs, safeFileName } from "./util";

describe("parseBildirimTs", () => {
  it("Türkiye saatini (UTC+3) doğru çevirir", () => {
    expect(parseBildirimTs("12.03.2026 14:22:10")?.toISOString()).toBe("2026-03-12T11:22:10.000Z");
  });
  it("geçersiz girdide null", () => {
    expect(parseBildirimTs("")).toBeNull();
    expect(parseBildirimTs("31.02.2026 10:00:00")).toBeNull();
    expect(parseBildirimTs("dün")).toBeNull();
  });
});

describe("safeFileName", () => {
  it("yol ve kontrol karakterlerini atar", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\x\\künye.pdf")).toBe("künye.pdf");
    expect(safeFileName("a\u0000b.csv")).toBe("ab.csv");
  });
});

describe("normalizeRecord", () => {
  it("eksik alanları boş metin yapar (orijinal sunucu davranışı)", () => {
    expect(normalizeRecord({ kunyeNo: " 1234567890 ", urun: " DOMATES " })).toEqual({
      kunyeNo: "1234567890", urun: "DOMATES", tip: "", bildirimTarihi: "", uretimYeri: "",
      uretimTarihi: "", ureticiAdi: "", miktar: "", fiyat: "",
    });
  });
  it("kısa künye no / boş ürün / nesne olmayanı reddeder", () => {
    expect(normalizeRecord({ kunyeNo: "123", urun: "X" })).toBeNull();
    expect(normalizeRecord({ kunyeNo: "1234567890", urun: "  " })).toBeNull();
    expect(normalizeRecord(null)).toBeNull();
    expect(normalizeRecord("x")).toBeNull();
  });
});
