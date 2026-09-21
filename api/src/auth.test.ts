import { describe, expect, it } from "vitest";
import { FailLimiter, hashPassword, normalizeUsername, parseCookies, validatePassword, validateUsername, verifyPassword } from "./auth";

describe("şifre hash", () => {
  it("doğru şifreyi doğrular, yanlışı reddeder", async () => {
    const h = await hashPassword("uzun-bir-sifre-1");
    expect(h.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("uzun-bir-sifre-1", h)).toBe(true);
    expect(await verifyPassword("yanlis", h)).toBe(false);
  });
  it("bozuk kayıtta false döner", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$a$b")).toBe(false);
  });
});

describe("doğrulama yardımcıları", () => {
  it("kullanıcı adı", () => {
    expect(validateUsername(normalizeUsername("  Manav "))).toBe(true);
    expect(validateUsername("a b")).toBe(false);
    expect(validateUsername("ab")).toBe(false);
  });
  it("şifre uzunluğu", () => {
    expect(validatePassword("kisa")).not.toBeNull();
    expect(validatePassword("yeterince-uzun")).toBeNull();
  });
  it("çerez ayrıştırma bozuk kodlamada patlamaz", () => {
    expect(parseCookies("a=1; kunye_sid=abc%20d; b=%E0%A4%A")).toMatchObject({ a: "1", kunye_sid: "abc d" });
  });
});

describe("FailLimiter", () => {
  it("limitte kilitler, clear ile açar", () => {
    const l = new FailLimiter(3, 60_000);
    for (let i = 0; i < 2; i++) l.fail("k");
    expect(l.retryAfterSec("k")).toBe(0);
    l.fail("k");
    expect(l.retryAfterSec("k")).toBeGreaterThan(0);
    l.clear("k");
    expect(l.retryAfterSec("k")).toBe(0);
    l.dispose();
  });
});
