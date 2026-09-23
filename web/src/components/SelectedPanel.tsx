"use client";
import { useEffect, useRef, useState } from "react";
import type { Kunye, Liste } from "@/lib/types";

interface Props {
  selected: Kunye[];
  aktifListe: Liste | null;
  dirty: boolean;
  onRemove: (no: string) => void;
  onClear: () => void;
  onSave: (ad: string) => Promise<string | null>;
  onPrint: () => void;
}

const varsayilanAd = () =>
  new Date().toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export default function SelectedPanel({ selected, aktifListe, dirty, onRemove, onClear, onSave, onPrint }: Props) {
  const [ad, setAd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const justSaved = useRef(false);

  // Başka liste açılınca/kapatılınca ad alanını doldur ve eski mesajı temizle (kendi kaydımız hariç)
  useEffect(() => {
    setAd(aktifListe?.ad ?? "");
    if (justSaved.current) justSaved.current = false;
    else setMsg(null);
  }, [aktifListe?.id, aktifListe?.ad]);

  const adDegisti = aktifListe != null && ad.trim() !== "" && ad.trim() !== aktifListe.ad;
  const kaydedilecek = dirty || adDegisti;

  async function save() {
    setBusy(true);
    setMsg(null);
    justSaved.current = true;
    const err = await onSave(ad.trim() || varsayilanAd());
    if (err) justSaved.current = false;
    setBusy(false);
    setMsg(err ? { text: err, ok: false } : { text: "Liste kaydedildi. Başka cihazdan \"Kayıtlı Listeler\"den açabilirsin.", ok: true });
  }

  let saveLabel = "💾 Listeyi kaydet";
  if (aktifListe) saveLabel = kaydedilecek ? "💾 Değişiklikleri kaydet" : "✓ Kaydedildi";

  return (
    <div className="panel" id="secili-panel">
      <h2>
        🧾 Seçili Künyeler <span className="badge">{selected.length}</span>
      </h2>
      {aktifListe && (
        <div className="aktif-liste">
          Açık liste: <b>{aktifListe.ad}</b>
          {dirty && <span className="kaydedilmedi"> · kaydedilmemiş değişiklik var</span>}
        </div>
      )}
      <div className="sel-list">
        {selected.length === 0 && <div className="empty">Henüz künye eklenmedi. Aramadan &quot;Ekle&quot; ile ekleyin.</div>}
        {selected.map((r) => (
          <div className="sel-item" key={r.kunyeNo}>
            <span>
              {r.urun}
              <small>{r.uretimYeri || r.kunyeNo}</small>
            </span>
            <button type="button" className="x" aria-label={r.urun + " künyesini kaldır"} onClick={() => onRemove(r.kunyeNo)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      {selected.length > 0 && (
        <div className="save-row">
          <label className="sr-only" htmlFor="liste-adi">
            Liste adı
          </label>
          <input
            id="liste-adi"
            type="text"
            maxLength={100}
            placeholder={"Liste adı (boş kalırsa: " + varsayilanAd() + ")"}
            value={ad}
            onChange={(e) => setAd(e.target.value)}
          />
          <button type="button" className="savebtn" disabled={busy || (aktifListe != null && !kaydedilecek)} onClick={() => void save()}>
            {busy ? "Kaydediliyor..." : saveLabel}
          </button>
        </div>
      )}
      {msg && <div className={"status " + (msg.ok ? "ok" : "err")}>{msg.text}</div>}

      <button type="button" className="printbtn" disabled={selected.length === 0} onClick={onPrint}>
        🖨️ A4 Yazdır
      </button>
      <button type="button" className="clearbtn" onClick={onClear}>
        {aktifListe ? "Listeyi kapat, yeni liste başlat" : "Seçilenleri temizle"}
      </button>
    </div>
  );
}
