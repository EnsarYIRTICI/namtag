/** Künye yaşı eşikleri (bildirim tarihinden bu yana geçen gün). Değiştirmek için burayı düzenleyin. */
export const ESKI_GUN = 15;
export const COK_ESKI_GUN = 30;

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
