import type { Pool } from "pg";
import { z } from "zod";

/**
 * Yönetim panelinden değiştirilebilen ayarlar. Veritabanında olmayan anahtar varsayılan değeri kullanır.
 * Yeni ayar: buraya alan + varsayılan ekleyin, arayüzde web/src/components/yonetim/AyarlarSekmesi.tsx.
 */
export const ayarSchema = z.object({
  /** Eksik evrak uyarısında geriye bakılan gün sayısı (bugün hariç). */
  eksikGunPenceresi: z.number().int().min(7).max(120),
  /** Bildirimi bu kadar gün geçmiş künye sarı uyarı alır. */
  tazelikEskiGun: z.number().int().min(1).max(365),
  /** Bildirimi bu kadar gün geçmiş künye kırmızı uyarı alır. */
  tazelikCokEskiGun: z.number().int().min(2).max(730),
  /** Bakım temizliği: bildirimi bu kadar günden eski künyeler silinir. */
  temizlikGun: z.number().int().min(30).max(3650),
});

export type Ayarlar = z.infer<typeof ayarSchema>;

export const VARSAYILAN_AYARLAR: Ayarlar = {
  eksikGunPenceresi: 30,
  tazelikEskiGun: 15,
  tazelikCokEskiGun: 30,
  temizlikGun: 180,
};

/** Kısmi güncelleme şeması: bilinmeyen anahtar reddedilir. */
export const ayarGuncelleSchema = ayarSchema.partial().strict();

export async function ayarlariOku(pool: Pool): Promise<Ayarlar> {
  const rows = (await pool.query("SELECT anahtar, deger FROM ayarlar")).rows as { anahtar: string; deger: unknown }[];
  const out: Ayarlar = { ...VARSAYILAN_AYARLAR };
  for (const r of rows) {
    const alan = ayarSchema.shape[r.anahtar as keyof Ayarlar];
    if (!alan) continue; // artık kullanılmayan eski anahtar
    const v = alan.safeParse(r.deger);
    if (v.success) (out as Record<string, unknown>)[r.anahtar] = v.data;
  }
  return out;
}

/** Birleşik (mevcut + yeni) ayarların tutarlılığı. Hata mesajı ya da null. */
export function ayarTutarlilik(a: Ayarlar): string | null {
  if (a.tazelikCokEskiGun <= a.tazelikEskiGun) return "Kırmızı uyarı eşiği sarı uyarı eşiğinden büyük olmalı.";
  return null;
}
