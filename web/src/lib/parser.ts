/**
 * Hal Kayıt Sistemi künye evrakı (CSV / HTML / PDF'ten çıkarılan satırlar) -> künye kayıtları.
 * Eski sürümdeki (public/index.html) ayrıştırıcının birebir TypeScript portu; davranış değişmemeli.
 */

export interface ParsedKunye {
  urun: string;
  tip?: string;
  kunyeNo: string;
  bildirimTarihi?: string;
  uretimYeri?: string;
  uretimTarihi?: string;
  ureticiAdi?: string;
  miktar?: string;
  fiyat?: string;
}

type FieldKey = "bildirimTarihi" | "uretimYeri" | "uretimTarihi" | "ureticiAdi" | "miktar" | "fiyat";

const FIELD_LABELS: Record<string, FieldKey> = {
  "Bildirim Tarihi": "bildirimTarihi",
  "Üretim Yeri": "uretimYeri",
  "Üretim Tarihi": "uretimTarihi",
  "Üreticisinin Adı": "ureticiAdi",
  Miktar: "miktar",
  "Alış Fiyatı": "fiyat",
};
const FIELD_RE = /^(Bildirim Tarihi|Üretim Yeri|Üretim Tarihi|Üreticisinin Adı|Miktar|Alış Fiyatı)\s*:\s*;?(.*)$/;
const KNO_RE = /^;?(\d{8,})\s*;?$/;

const isFootnoteStart = (line: string) => line.indexOf("Gümrük") !== -1 && line.indexOf("Bakanlığı") !== -1;
const isFootnoteEnd = (line: string) => /sorgulayabilirsiniz\.?;?$/i.test(line);

type Stage = "urun" | "tip" | "kno" | "fields" | "footnote";

export function linesToRecords(lines: string[]): ParsedKunye[] {
  const records: ParsedKunye[] = [];
  let cur: Partial<ParsedKunye> | null = null;
  let stage: Stage = "urun";
  let lastFieldKey: FieldKey | null = null;
  let lastPieceLen = 0;

  function finalize() {
    if (cur && cur.urun && cur.kunyeNo) records.push(cur as ParsedKunye);
    cur = null;
    stage = "urun";
    lastFieldKey = null;
  }

  for (let line of lines) {
    line = line.replace(/\u00A0/g, " ").trim();
    if (!line) continue;

    if (isFootnoteStart(line) || stage === "footnote") {
      stage = "footnote";
      if (isFootnoteEnd(line)) finalize();
      continue;
    }
    if (stage === "urun") {
      cur = {};
      cur.urun = line.replace(/;+$/, "").trim();
      stage = "tip";
      continue;
    }
    if (stage === "tip") {
      cur!.tip = line.replace(/;+$/, "").trim();
      stage = "kno";
      continue;
    }
    if (stage === "kno") {
      const km = line.match(KNO_RE);
      if (km) {
        cur!.kunyeNo = km[1];
        stage = "fields";
        lastFieldKey = null;
      }
      continue;
    }
    if (stage === "fields") {
      const fm = line.match(FIELD_RE);
      if (fm) {
        const key = FIELD_LABELS[fm[1]!]!;
        const val = fm[2]!.replace(/;+$/, "").trim();
        cur![key] = val;
        lastFieldKey = key;
        lastPieceLen = val.length;
      } else if (lastFieldKey) {
        const piece = line.replace(/;+$/, "").trim();
        // Hal sistemi 'Üretim Yeri'ni tam 25 karakterde, kelime ortasından bile böler
        // (ör. 'İSTANBUL/ARNAVUTKÖY/MERKE' + 'Z KÖYLER'). Bu durumda boşluksuz birleştir.
        // Ayrı satırdaki 'KÖYLER' eki ise gerçek bir sözcük, boşluk kalmalı.
        const wrapped =
          lastFieldKey === "uretimYeri" && piece !== "KÖYLER" && (lastPieceLen === 25 || piece.charAt(0) === "/");
        cur![lastFieldKey] = ((cur![lastFieldKey] ?? "") + (wrapped ? "" : " ") + piece).trim();
        lastPieceLen = piece.length;
      }
      continue;
    }
  }

  const last = cur as Partial<ParsedKunye> | null;
  if (last && last.urun && last.kunyeNo && last.fiyat) records.push(last as ParsedKunye);

  for (const r of records) {
    if (r.fiyat) {
      let v = r.fiyat.replace(/\?\s*$/, "").trim();
      if (!/₺/.test(v)) v = v + " ₺";
      r.fiyat = v;
    }
  }
  return records;
}
