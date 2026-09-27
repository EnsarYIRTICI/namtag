export interface Kunye {
  kunyeNo: string;
  urun: string;
  tip: string;
  bildirimTarihi: string;
  uretimYeri: string;
  uretimTarihi: string;
  ureticiAdi: string;
  miktar: string;
  fiyat: string;
  kaynakDosya: string;
  evrakId: string | null;
  yuklemeZamani: string;
  /** Aynı ürünün arşivdeki en yeni künyesi mi */
  enYeni?: boolean;
  /** En yeni değilse, en yeni künyenin bildirim tarihi */
  dahaYeni?: string | null;
  /** Bildirimden bu yana geçen gün */
  yasGun?: number | null;
}

/** Künyesi henüz arşive gelmemiş, listeye not düşülmüş ürün */
export interface Bekleyen {
  /** Sunucudaki satır; kaydedilmemiş yeni satırda yok */
  id?: string;
  urun: string;
  aciklama: string;
  olusturma?: string;
  /** Not düşüldükten sonra yüklenen ve adı eşleşen künyeler (her farklı ürün için en yenisi) */
  adaylar?: { kunyeNo: string; urun: string; bildirimTarihi: string }[];
}

export interface Eksikler {
  pencereGun: number;
  eksik: string[];
  muaf: { gun: string; isaretleyen: string }[];
}

export interface Evrak {
  id: string;
  ad: string;
  adet: number;
  boyut: number | null;
  dosyaVar: boolean;
  yuklemeZamani: string;
  /** İçindeki künyelerin en yeni bildirim günü (YYYY-AA-GG); künyelerin tarihi yoksa null */
  evrakTarihi: string | null;
}

export type Rol = "yonetici" | "personel";

export interface Me {
  username: string;
  rol: Rol;
  version: string;
  commit: string;
  startedAt: string;
}

export interface UploadResult {
  evrakId: string | null;
  added: number;
  skipped: number;
  skippedNos: string[];
  invalid: number;
  duplicate: boolean;
}

/** Önceden hazırlanıp kaydedilmiş yazdırma listesi */
export interface Liste {
  id: string;
  ad: string;
  olusturan: string;
  olusturma: string;
  guncelleme: string;
  sonYazdirma: string | null;
  kunyeNos: string[];
  bekleyenler: Bekleyen[];
}

/** Yönetim panelinden değiştirilebilen ayarlar (api/src/ayarlar.ts ile aynı) */
export interface Ayarlar {
  eksikGunPenceresi: number;
  tazelikEskiGun: number;
  tazelikCokEskiGun: number;
  temizlikGun: number;
}

export interface Kullanici {
  username: string;
  rol: Rol;
  aktif: boolean;
  createdAt: string;
  sonGiris: string | null;
  acikOturum: number;
}

export interface IslemKaydi {
  id: string;
  zaman: string;
  kullanici: string | null;
  islem: string;
  detay: Record<string, unknown>;
  ip: string | null;
}

export interface Istatistik {
  gun: number;
  ozet: {
    toplamKunye: number;
    toplamEvrak: number;
    toplamListe: number;
    aktifKullanici: number;
    sonKunye: number;
    sonUrunCesidi: number;
    sonEvrak: number;
  };
  gunluk: { gun: string; kunye: number; evrak: number }[];
  enCokUrun: { urun: string; adet: number }[];
  kullaniciYukleme: { kullanici: string; evrak: number; kunye: number }[];
}
