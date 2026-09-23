"use client";
import { useState } from "react";
import type { Eksikler, Liste } from "@/lib/types";
import { gunAdi } from "@/lib/tazelik";

interface Props {
  eksikler: Eksikler | null;
  listeler: Liste[];
  aktifId: string | null;
  onMuaf: (gun: string) => Promise<void>;
  onMuafGeriAl: (gun: string) => Promise<void>;
  onListeAc: (l: Liste) => void;
}

/** Sayfanın üstündeki uyarılar: eksik evrak günleri ve künyesi gelen bekleyen ürünler. */
export default function Bildirimler({ eksikler, listeler, aktifId, onMuaf, onMuafGeriAl, onListeAc }: Props) {
  const [mesgul, setMesgul] = useState<string | null>(null);

  const gelenler = listeler
    .map((l) => ({ l, n: l.bekleyenler.filter((b) => b.adaylar?.length).length }))
    .filter((x) => x.n > 0);
  const gelenToplam = gelenler.reduce((a, x) => a + x.n, 0);
  const eksik = eksikler?.eksik ?? [];
  const muaf = eksikler?.muaf ?? [];

  if (eksik.length === 0 && gelenToplam === 0 && muaf.length === 0) return null;

  const isle = async (gun: string, f: (g: string) => Promise<void>) => {
    setMesgul(gun);
    await f(gun);
    setMesgul(null);
  };

  return (
    <div className="bildirimler wrap !pb-0">
      {gelenToplam > 0 && (
        <div className="bildirim geldi" role="status">
          <b>📬 Bekleyen {gelenToplam} ürünün künyesi geldi.</b>
          <div className="bildirim-aksiyon">
            {gelenler.map(({ l, n }) =>
              l.id === aktifId ? (
                <span key={l.id} className="acik-not">
                  &quot;{l.ad}&quot; açık ({n})
                </span>
              ) : (
                <button type="button" key={l.id} onClick={() => onListeAc(l)}>
                  &quot;{l.ad}&quot; listesini aç ({n})
                </button>
              ),
            )}
          </div>
        </div>
      )}

      {eksik.length > 0 && (
        <details className="bildirim eksik">
          <summary>
            <b>⚠️ Son {eksikler!.pencereGun} günde {eksik.length} günün künye evrakı yüklenmemiş</b>
            <span className="son-gun">En son: {gunAdi(eksik[0]!)}</span>
          </summary>
          <p className="bildirim-aciklama">
            O gün bildirilmiş hiçbir künye arşivde yok. Evrakı yükle ya da o gün alım yapmadıysan işaretle, bir daha
            uyarmasın. Bugün sayılmaz.
          </p>
          <ul>
            {eksik.map((g) => (
              <li key={g}>
                <span>{gunAdi(g)}</span>
                <button type="button" disabled={mesgul === g} onClick={() => void isle(g, onMuaf)}>
                  Alım yapılmadı
                </button>
              </li>
            ))}
          </ul>
          {muaf.length > 0 && <MuafListe muaf={muaf} mesgul={mesgul} onGeriAl={(g) => void isle(g, onMuafGeriAl)} />}
        </details>
      )}

      {eksik.length === 0 && muaf.length > 0 && (
        <details className="bildirim sessiz">
          <summary>✓ Son {eksikler!.pencereGun} günün evrakları tamam</summary>
          <MuafListe muaf={muaf} mesgul={mesgul} onGeriAl={(g) => void isle(g, onMuafGeriAl)} />
        </details>
      )}
    </div>
  );
}

function MuafListe({ muaf, mesgul, onGeriAl }: { muaf: Eksikler["muaf"]; mesgul: string | null; onGeriAl: (g: string) => void }) {
  return (
    <div className="muaf">
      <div className="muaf-baslik">&quot;Alım yapılmadı&quot; olarak işaretlenen günler:</div>
      <ul>
        {muaf.map((m) => (
          <li key={m.gun}>
            <span>
              {gunAdi(m.gun)}
              {m.isaretleyen ? <small> · {m.isaretleyen}</small> : null}
            </span>
            <button type="button" className="geri" disabled={mesgul === m.gun} onClick={() => onGeriAl(m.gun)}>
              Geri al
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
