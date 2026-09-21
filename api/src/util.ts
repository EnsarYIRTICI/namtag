/** "dd.mm.yyyy hh:mm:ss" (Türkiye saati, UTC+3) -> Date. Ayrıştırılamazsa/imkânsız tarihse null. */
export function parseBildirimTs(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [d, mo, y, h, mi, se] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number, number];
  const utc = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  // JS taşan değerleri sessizce kaydırır (31.02 -> 3 Mart); gidiş-dönüş kontrolüyle reddet.
  if (
    utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d ||
    utc.getUTCHours() !== h || utc.getUTCMinutes() !== mi || utc.getUTCSeconds() !== se
  ) return null;
  return new Date(utc.getTime() - 3 * 3600 * 1000); // Türkiye UTC+3 (yaz saati uygulaması yok)
}

export function safeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  // kontrol karakterlerini at, uzunluğu sınırla
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
}
