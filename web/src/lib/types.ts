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
}

export interface Me {
  username: string;
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
