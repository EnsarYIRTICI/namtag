/** "dd.mm.yyyy hh:mm:ss" -> epoch ms (yerel saat); okunamazsa 0. Sadece sıralama için. */
export function parseTRDateTime(s: string | undefined): number {
  if (!s) return 0;
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  return new Date(+m[3]!, +m[2]! - 1, +m[1]!, +m[4]!, +m[5]!, +m[6]!).getTime();
}

/** Türkçe büyük harf (i→İ, ı→I): arama büyük/küçük harf ve Türkçe karakter duyarsız olsun. */
export function trUpper(s: string | undefined): string {
  return (s || "").replace(/i/g, "İ").replace(/ı/g, "I").toLocaleUpperCase("tr-TR");
}
