import type { Request } from "express";
import type { Pool } from "pg";

/**
 * İşlem kaydında kullanılan işlem adları. Arayüz bunları Türkçe etiketlerle gösterir (web/src/lib/islemler.ts).
 * Yeni işlem eklerken iki listeyi birlikte güncelleyin.
 */
export type Islem =
  | "giris"
  | "giris_hatali"
  | "cikis"
  | "sifre_degistir"
  | "evrak_yukle"
  | "evrak_sil"
  | "kunye_sil"
  | "temizlik"
  | "muaf_isaretle"
  | "muaf_geri_al"
  | "liste_sil"
  | "kullanici_ekle"
  | "kullanici_sil"
  | "kullanici_rol"
  | "kullanici_aktif"
  | "kullanici_sifre"
  | "kullanici_oturum_kapat"
  | "ayar_degistir";

/** Bu süreden eski kayıtlar saatlik bakımda silinir. */
export const KAYIT_SAKLAMA_GUN = 365;

/**
 * İşlemi kaydeder. Kayıt başarısız olursa asıl işlemi bozmaz, sadece loglar.
 * kullanici verilmezse oturumdaki kullanıcı yazılır.
 */
export async function kaydet(
  pool: Pool,
  req: Request,
  islem: Islem,
  detay: Record<string, unknown> = {},
  kullanici?: string | null,
): Promise<void> {
  try {
    await pool.query("INSERT INTO islem_kaydi (kullanici, islem, detay, ip) VALUES ($1, $2, $3::jsonb, $4)", [
      kullanici !== undefined ? kullanici : (req.user?.username ?? null),
      islem,
      JSON.stringify(detay),
      req.ip ?? null,
    ]);
  } catch (e) {
    console.warn("İşlem kaydı yazılamadı:", islem, (e as Error).message);
  }
}

export function eskiKayitlariSil(pool: Pool): Promise<unknown> {
  return pool.query("DELETE FROM islem_kaydi WHERE zaman < now() - make_interval(days => $1)", [KAYIT_SAKLAMA_GUN]);
}
