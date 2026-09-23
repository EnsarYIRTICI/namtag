import { describe, expect, it } from "vitest";
import { listeBody } from "./routes/listeler";

describe("liste gövdesi", () => {
  it("adı kırpar, künyeleri sırası korunarak tekilleştirir", () => {
    const r = listeBody.parse({ ad: "  Tezgah 23 Eylül \u0007", kunyeNos: ["2163359260172911985", " 2313959260172791930", "2163359260172911985"] });
    expect(r).toEqual({ ad: "Tezgah 23 Eylül", kunyeNos: ["2163359260172911985", "2313959260172791930"], bekleyenler: [] });
  });
  it("boş ad, boş liste ve geçersiz numarayı reddeder", () => {
    expect(listeBody.safeParse({ ad: "   ", kunyeNos: ["2163359260172911985"] }).success).toBe(false);
    expect(listeBody.safeParse({ ad: "x", kunyeNos: [] }).success).toBe(false);
    expect(listeBody.safeParse({ ad: "x", kunyeNos: [], bekleyenler: [{ urun: "  " }] }).success).toBe(false);
    expect(listeBody.safeParse({ ad: "x", kunyeNos: ["abc"] }).success).toBe(false);
    expect(listeBody.safeParse({ ad: "x".repeat(101), kunyeNos: ["2163359260172911985"] }).success).toBe(false);
  });
  it("sadece bekleyen ürünlü liste geçerli; boşlukları sadeleştirir", () => {
    const r = listeBody.parse({ ad: "Manav", kunyeNos: [], bekleyenler: [{ urun: "  biber   sivri ", aciklama: "2 kasa" }] });
    expect(r.bekleyenler).toEqual([{ urun: "biber sivri", aciklama: "2 kasa" }]);
  });
});
