/**
 * Künye yaşı eşikleri (bildirim tarihinden bu yana geçen gün). Varsayılanlar burada; gerçek değerler açılışta
 * sunucudaki ayarlardan gelir (Yönetim > Ayarlar) ve esikleriAyarla ile yazılır. `let` export'u canlı bağdır:
 * içe aktaran bileşenler güncel değeri görür.
 */
export let ESKI_GUN = 15;
export let COK_ESKI_GUN = 30;

export function esikleriAyarla(eski: number, cokEski: number): void {
  ESKI_GUN = eski;
  COK_ESKI_GUN = cokEski;
}

export type YasSeviye = "eski" | "cok-eski" | null;

export function yasSeviye(yasGun: number | null | undefined): YasSeviye {
  if (yasGun == null) return null;
  if (yasGun >= COK_ESKI_GUN) return "cok-eski";
  if (yasGun >= ESKI_GUN) return "eski";
  return null;
}

/** "23.09.2026 06:59:45" -> "23.09.2026" */
export const tarihKismi = (s: string | null | undefined) => (s || "").split(" ")[0] || "";

/** "2026-09-14" -> "14 Eylül Pazartesi" (saat dilimi kaymasın diye öğlen alınır) */
export function gunAdi(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" });
}
