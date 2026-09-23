"use client";
import { useEffect, useRef, useState } from "react";
import type { Bekleyen, Kunye, Liste } from "@/lib/types";
import { tarihKismi, yasSeviye } from "@/lib/tazelik";
import TazelikIsaret from "./TazelikIsaret";

type Aday = NonNullable<Bekleyen["adaylar"]>[number];

interface Props {
  selected: Kunye[];
  bekleyenler: Bekleyen[];
  aktifListe: Liste | null;
  dirty: boolean;
  onRemove: (no: string) => void;
  onBekleyenSil: (index: number) => void;
  onEslestir: (index: number, aday: Aday) => Promise<void>;
  onTumunuEslestir: () => Promise<void>;
  onClear: () => void;
  onSave: (ad: string) => Promise<string | null>;
  onPrint: () => void;
}

const varsayilanAd = () =>
  new Date().toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export default function SelectedPanel(p: Props) {
  const { selected, bekleyenler, aktifListe, dirty } = p;
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
  const bosMu = selected.length === 0 && bekleyenler.length === 0;

  const eskiSayisi = selected.filter((k) => yasSeviye(k.yasGun) || (!k.enYeni && k.dahaYeni)).length;
  const tekAdayli = bekleyenler.filter((b) => b.adaylar?.length === 1).length;

  async function save() {
    setBusy(true);
    setMsg(null);
    justSaved.current = true;
    const err = await p.onSave(ad.trim() || varsayilanAd());
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
      {eskiSayisi > 0 && (
        <div className="tz-ozet" role="note">
          ⚠ {eskiSayisi} künye eski ya da daha yenisi var. Yazdırmadan önce kontrol et.
        </div>
      )}
      <div className="sel-list">
        {bosMu && <div className="empty">Henüz künye eklenmedi. Aramadan &quot;Ekle&quot; ile ekleyin.</div>}
        {selected.map((r) => (
          <div className="sel-item" key={r.kunyeNo}>
            <span>
              {r.urun}
              <small>
                {r.uretimYeri || r.kunyeNo} · {tarihKismi(r.bildirimTarihi) || "tarih yok"}
              </small>
              <TazelikIsaret k={r} />
            </span>
            <button type="button" className="x" aria-label={r.urun + " künyesini kaldır"} onClick={() => p.onRemove(r.kunyeNo)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      {bekleyenler.length > 0 && (
        <div className="bekleyen-blok">
          <div className="bekleyen-baslik">
            <span>⏳ Künyesi beklenen ürünler ({bekleyenler.length})</span>
            {tekAdayli > 1 && (
              <button type="button" onClick={() => void p.onTumunuEslestir()}>
                Gelenlerin hepsini ekle ({tekAdayli})
              </button>
            )}
          </div>
          {bekleyenler.map((b, i) => (
            <div className={"bekleyen-item" + (b.adaylar?.length ? " geldi" : "")} key={b.id ?? "yeni-" + i}>
              <div className="min-w-0">
                <b>{b.urun}</b>
                {b.aciklama && <small>{b.aciklama}</small>}
                {!b.id && <small>Kaydedince, bu ürünün künyesi yüklendiğinde haber verilir.</small>}
                {b.id && !b.adaylar?.length && <small>Künyesi bekleniyor.</small>}
                {b.adaylar?.length === 1 && (
                  <div className="aday-satir">
                    <span>
                      📬 Künyesi geldi: {b.adaylar[0]!.urun} · {tarihKismi(b.adaylar[0]!.bildirimTarihi)}
                    </span>
                    <button type="button" onClick={() => void p.onEslestir(i, b.adaylar![0]!)}>
                      Listeye ekle
                    </button>
                  </div>
                )}
                {(b.adaylar?.length ?? 0) > 1 && (
                  <div className="aday-satir">
                    <span>📬 {b.adaylar!.length} farklı ürün eşleşti, hangisi?</span>
                    <div className="aday-secenek">
                      {b.adaylar!.map((a) => (
                        <button type="button" key={a.kunyeNo} onClick={() => void p.onEslestir(i, a)} title={a.bildirimTarihi}>
                          {a.urun}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button type="button" className="x" aria-label={b.urun + " bekleyen ürününü kaldır"} onClick={() => p.onBekleyenSil(i)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {!bosMu && (
        <div className="save-row">
          <label className="sr-only" htmlFor="liste-adi">
            Liste adı
          </label>
          <input
            id="liste-adi"
            type="text"
            maxLength={100}
            placeholder="Liste adı (isteğe bağlı)"
            title={"Boş bırakılırsa ad olarak tarih kullanılır: " + varsayilanAd()}
            value={ad}
            onChange={(e) => setAd(e.target.value)}
          />
          <button type="button" className="savebtn" disabled={busy || (aktifListe != null && !kaydedilecek)} onClick={() => void save()}>
            {busy ? "Kaydediliyor..." : saveLabel}
          </button>
        </div>
      )}
      {msg && <div className={"status " + (msg.ok ? "ok" : "err")}>{msg.text}</div>}

      <button type="button" className="printbtn" disabled={selected.length === 0} onClick={p.onPrint}>
        🖨️ A4 Yazdır
      </button>
      {bekleyenler.length > 0 && selected.length > 0 && (
        <div className="print-not">Bekleyen {bekleyenler.length} ürünün künyesi olmadığı için yazdırılmaz.</div>
      )}
      <button type="button" className="clearbtn" onClick={p.onClear}>
        {aktifListe ? "Listeyi kapat, yeni liste başlat" : "Seçilenleri temizle"}
      </button>
    </div>
  );
}
