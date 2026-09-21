import type { SessionUser } from "./auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export interface KunyeRow {
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
