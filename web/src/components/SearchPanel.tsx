"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Kunye } from "@/lib/types";
import TazelikIsaret from "./TazelikIsaret";

interface Props {
  /** Arşivdeki toplam künye sayısı (rozet) */
  toplam: number;
  selected: Kunye[];
  onAdd: (k: Kunye) => void;
  /** Arşiv değişince (yükleme/silme) artar; açık arama yeniden yapılır */
  refreshKey: number;
  /** Künyesi arşivde olmayan ürünü listeye "bekleyen" olarak ekler */
  onBekleyenEkle: (urun: string) => void;
  /** Zaten bekleyen olarak eklenmiş ürün adları (küçük harf) */
  bekleyenAdlari: string[];
}

interface Sonuc {
  items: Kunye[];
  toplam: number;
}

const LIMIT = 20;

export default function SearchPanel({ toplam, selected, onAdd, refreshKey, onBekleyenEkle, bekleyenAdlari }: Props) {
  const [query, setQuery] = useState("");
  const [sonuc, setSonuc] = useState<Sonuc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reqId = useRef(0);

  // Arama sunucuda yapılır: yazmayı bırakınca (250 ms) istek atılır, eski istekler iptal edilir.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSonuc(null);
      setLoading(false);
      setError("");
      return;
    }
    const id = ++reqId.current;
    const ctrl = new AbortController();
    setLoading(true);
    const t = window.setTimeout(() => {
      api<Sonuc>(`/api/kunyeler?q=${encodeURIComponent(q)}&limit=${LIMIT}`, { signal: ctrl.signal })
        .then((r) => {
          if (id !== reqId.current) return;
          setSonuc(r);
          setError("");
        })
        .catch((e: Error) => {
          if (e.name === "AbortError" || id !== reqId.current) return;
          setError(e instanceof TypeError ? "Sunucuya ulaşılamıyor." : "Arama yapılamadı: " + e.message);
        })
        .finally(() => {
          if (id === reqId.current) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [query, refreshKey]);

  const bos = !query.trim();

  return (
    <div className="panel">
      <h2>
        🔍 Ürün Ara <span className="badge">{toplam}</span>
      </h2>
      <div className="search-box">
        <input
          type="search"
          placeholder="örn: domates, limon, şeftali..."
          autoComplete="off"
          enterKeyHint="search"
          aria-label="Ürün adı"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="results" aria-busy={loading}>
        {bos && <div className="empty">Aramaya başlamak için ürün adı yazın.</div>}
        {!bos && error && <div className="status err">{error}</div>}
        {!bos && !error && !sonuc && loading && <div className="empty">Aranıyor...</div>}
        {!bos && !error && sonuc && sonuc.items.length === 0 && !loading && (
          <div className="empty">Eşleşen künye bulunamadı.</div>
        )}
        {!bos &&
          !error &&
          sonuc?.items.map((r) => {
            const already = selected.some((s) => s.kunyeNo === r.kunyeNo);
            return (
              <div className={"rcard" + (loading ? " opacity-60" : "")} key={r.kunyeNo}>
                <div className="rinfo">
                  <b>{r.urun}</b>
                  <TazelikIsaret k={r} />
                  <div className="sub">
                    {r.tip || ""} · {r.uretimYeri || ""}
                  </div>
                  <div className="sub">
                    Bildirim: {r.bildirimTarihi || "-"} · {r.miktar || ""} · {r.fiyat || ""}
                  </div>
                </div>
                <button type="button" disabled={already} onClick={() => onAdd(r)}>
                  {already ? "Eklendi" : "Ekle"}
                </button>
              </div>
            );
          })}
        {!bos && !error && sonuc && sonuc.toplam > sonuc.items.length && (
          <div className="empty">
            {sonuc.toplam} sonuçtan en yeni {sonuc.items.length} tanesi gösteriliyor. Daraltmak için aramayı uzatın.
          </div>
        )}
        {!bos && !error && sonuc && !loading && (
          <div className="bekleyen-oneri">
            {bekleyenAdlari.includes(query.trim().toLocaleLowerCase("tr-TR")) ? (
              <span>
                &quot;{query.trim()}&quot; bekleyen ürünlere eklendi.
              </span>
            ) : (
              <>
                <span>{sonuc.items.length === 0 ? "Künyesi henüz gelmediyse" : "Aradığın künye yok mu?"}</span>
                <button type="button" onClick={() => onBekleyenEkle(query.trim())}>
                  ⏳ &quot;{query.trim()}&quot; ürününü bekleyen olarak ekle
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
