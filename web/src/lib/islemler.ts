import type { IslemKaydi } from "./types";

/** İşlem kaydındaki işlem adlarının Türkçe etiketleri (api/src/islemKaydi.ts ile aynı liste). */
export const ISLEM_ETIKET: Record<string, string> = {
  giris: "Giriş",
  giris_hatali: "Hatalı giriş",
  cikis: "Çıkış",
  sifre_degistir: "Kendi şifresini değiştirdi",
  evrak_yukle: "Evrak yükledi",
  evrak_sil: "Evrak sildi",
  kunye_sil: "Künye sildi",
  temizlik: "Eski kayıt temizliği",
  muaf_isaretle: "\"Alım yapılmadı\" işaretledi",
  muaf_geri_al: "\"Alım yapılmadı\" geri aldı",
  liste_sil: "Liste sildi",
  kullanici_ekle: "Kullanıcı ekledi",
  kullanici_sil: "Kullanıcı sildi",
  kullanici_rol: "Rol değiştirdi",
  kullanici_aktif: "Hesap durumu değiştirdi",
  kullanici_sifre: "Kullanıcı şifresi sıfırladı",
  kullanici_oturum_kapat: "Oturumları kapattı",
  ayar_degistir: "Ayar değiştirdi",
};

/** Dikkat çekmesi gereken işlemler (silme, yetki) */
export const ONEMLI_ISLEMLER = new Set([
  "evrak_sil",
  "kunye_sil",
  "temizlik",
  "kullanici_sil",
  "kullanici_rol",
  "kullanici_aktif",
  "kullanici_sifre",
  "giris_hatali",
]);

export const AYAR_ETIKET: Record<string, string> = {
  eksikGunPenceresi: "Eksik evrak penceresi",
  tazelikEskiGun: "Sarı uyarı eşiği",
  tazelikCokEskiGun: "Kırmızı uyarı eşiği",
  temizlikGun: "Temizlik süresi",
};

const rolAdi = (r: unknown) => (r === "yonetici" ? "yönetici" : "personel");
const gunFmt = (g: unknown) => (typeof g === "string" ? g.split("-").reverse().join(".") : "");

/** Kaydın ayrıntısını tek satır okunur metne çevirir. */
export function islemDetay(k: IslemKaydi): string {
  const d = k.detay as Record<string, any>;
  switch (k.islem) {
    case "giris_hatali":
      return d.neden === "pasif" ? "hesap pasif" : "şifre ya da kullanıcı adı hatalı";
    case "evrak_yukle":
      return `${d.ad ?? ""} · ${d.eklenen ?? 0} künye eklendi${d.atlanan ? `, ${d.atlanan} zaten vardı` : ""}`;
    case "evrak_sil":
      return `${d.ad ?? ""} · ${d.silinenKunye ?? 0} künye silindi`;
    case "kunye_sil":
      return String(d.kunyeNo ?? "");
    case "temizlik":
      return `${d.gun} günden eski · ${d.silinen ?? 0} künye silindi`;
    case "muaf_isaretle":
    case "muaf_geri_al":
      return gunFmt(d.gun);
    case "liste_sil":
      return String(d.ad ?? "");
    case "kullanici_ekle":
      return `${d.hedef} (${rolAdi(d.rol)})`;
    case "kullanici_rol":
      return `${d.hedef} → ${rolAdi(d.rol)}`;
    case "kullanici_aktif":
      return `${d.hedef} → ${d.aktif ? "aktif" : "pasif"}`;
    case "kullanici_sil":
    case "kullanici_sifre":
      return String(d.hedef ?? "");
    case "kullanici_oturum_kapat":
      return `${d.hedef} · ${d.kapatilan ?? 0} oturum`;
    case "ayar_degistir":
      return Object.entries(d)
        .map(([k, v]) => `${AYAR_ETIKET[k] ?? k}: ${(v as any)?.eski} → ${(v as any)?.yeni}`)
        .join(", ");
    default:
      return Object.keys(d).length ? JSON.stringify(d) : "";
  }
}
