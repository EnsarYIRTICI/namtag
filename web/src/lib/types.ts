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
}
