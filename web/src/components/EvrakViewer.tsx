"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadPdfjs } from "@/lib/pdfjs";
import type { Evrak } from "@/lib/types";

/**
 * Yüklenen orijinal evrağı indirmeden, sayfanın içinde gösterir.
 * - PDF: pdf.js ile tuvale çizilir (tarayıcının PDF eklentisine ya da indirmeye gerek yok, telefonda da çalışır)
 * - HTML: betik çalıştıramayan, dışarıya istek atamayan yalıtılmış bir çerçevede
 * - CSV: tablo olarak
 */

type Icerik =
  | { tur: "pdf"; data: Uint8Array }
  | { tur: "html"; html: string }
  | { tur: "csv"; satirlar: string[][] };

const ext = (ad: string) => (ad.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

/** Geçerli UTF-8 ise UTF-8, değilse Windows-1254 (Hal evraklarının eski Türkçe kodlaması). */
function decode(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1254").decode(buf);
  }
}

/** Tırnaklı alanları destekleyen basit CSV ayrıştırıcı; ayırıcı ilk satırdan tahmin edilir. */
function parseCsv(text: string): string[][] {
  const ilk = text.split(/\r?\n/, 1)[0] ?? "";
  const ayirici = [";", ",", "\t"].sort((a, b) => ilk.split(b).length - ilk.split(a).length)[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let tirnak = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (tirnak) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') tirnak = false;
      else cell += c;
    } else if (c === '"') tirnak = true;
    else if (c === ayirici) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

// Evrak HTML'i yalıtılmış çerçevede: betik yok, dış kaynak (resim, font, iz) yüklenmez.
const HTML_CSP =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">';

function PdfSayfalar({ data, zoom }: { data: Uint8Array; zoom: number }) {
  const kap = useRef<HTMLDivElement>(null);
  const [genislik, setGenislik] = useState(0);
  const [durum, setDurum] = useState<{ sayfa: number; toplam: number; hata?: string }>({ sayfa: 0, toplam: 0 });

  // Kap genişliğini izle (telefon döndürme, pencere boyutu)
  useEffect(() => {
    // Sayfaların kendisini değil kaydırma alanını ölç: yakınlaştırınca içerik genişler, döngü olmasın
    const el = kap.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setGenislik(Math.floor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = kap.current;
    if (!el || genislik === 0) return;
    let iptal = false;
    const gorevler: { cancel: () => void }[] = [];
    let yukleme: { destroy: () => Promise<void> } | null = null;

    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        // pdf.js kendisine verilen diziyi devralır; her çizimde kopyasını ver
        const task = pdfjs.getDocument({ data: data.slice() });
        yukleme = task;
        const pdf = await task.promise;
        if (iptal) return;
        el.replaceChildren();
        setDurum({ sayfa: 0, toplam: pdf.numPages });
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const hedef = (genislik - 24) * zoom; // CSS pikseli (p-3 iç boşluk düşülür)
        for (let p = 1; p <= pdf.numPages && !iptal; p++) {
          const page = await pdf.getPage(p);
          const temel = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (hedef / temel.width) * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = Math.floor(viewport.width / dpr) + "px";
          canvas.style.height = Math.floor(viewport.height / dpr) + "px";
          canvas.setAttribute("aria-label", `Sayfa ${p} / ${pdf.numPages}`);
          canvas.className = "viewer-sayfa";
          el.appendChild(canvas);
          const task = page.render({ canvas, viewport });
          gorevler.push(task);
          await task.promise;
          if (!iptal) setDurum({ sayfa: p, toplam: pdf.numPages });
        }
      } catch (e) {
        const err = e as Error;
        if (iptal || err?.name === "RenderingCancelledException") return;
        setDurum((d) => ({ ...d, hata: "PDF gösterilemedi: " + err.message }));
      }
    })();

    return () => {
      iptal = true;
      gorevler.forEach((t) => t.cancel());
      void yukleme?.destroy();
    };
  }, [data, zoom, genislik]);

  return (
    <>
      {durum.hata && <div className="status err px-4">{durum.hata}</div>}
      {!durum.hata && durum.sayfa < durum.toplam && (
        <div className="viewer-ilerleme" aria-live="polite">
          Sayfa çiziliyor: {durum.sayfa} / {durum.toplam}
        </div>
      )}
      <div ref={kap} className="viewer-pdf" />
    </>
  );
}

export default function EvrakViewer({ evrak, onClose }: { evrak: Evrak; onClose: () => void }) {
  const [icerik, setIcerik] = useState<Icerik | null>(null);
  const [hata, setHata] = useState("");
  const [zoom, setZoom] = useState(1);
  const kapatBtn = useRef<HTMLButtonElement>(null);
  const url = `/api/evraklar/${evrak.id}/dosya`;

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin", signal: ctrl.signal });
        if (res.status === 401) {
          location.href = "/login";
          return;
        }
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || "HTTP " + res.status);
        }
        const buf = await res.arrayBuffer();
        const t = ext(evrak.ad);
        if (t === "pdf") setIcerik({ tur: "pdf", data: new Uint8Array(buf) });
        else if (t === "html" || t === "htm") setIcerik({ tur: "html", html: HTML_CSP + decode(buf) });
        else if (t === "csv") setIcerik({ tur: "csv", satirlar: parseCsv(decode(buf)) });
        else throw new Error("Bu dosya türü görüntülenemiyor, indirip açabilirsiniz.");
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") return;
        setHata(err instanceof TypeError ? "Sunucuya ulaşılamıyor." : err.message);
      }
    })();
    return () => ctrl.abort();
  }, [url, evrak.ad]);

  // Esc ile kapat, arkadaki sayfa kaymasın, kapanınca odak geri dönsün
  const kapat = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const onceki = document.activeElement as HTMLElement | null;
    kapatBtn.current?.focus();
    const tus = (e: KeyboardEvent) => {
      if (e.key === "Escape") kapat();
    };
    document.addEventListener("keydown", tus);
    const eskiOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", tus);
      document.body.style.overflow = eskiOverflow;
      onceki?.focus?.();
    };
  }, [kapat]);

  return (
    <div className="viewer-arka" onClick={(e) => e.target === e.currentTarget && kapat()}>
      <div className="viewer" role="dialog" aria-modal="true" aria-labelledby="viewer-baslik">
        <div className="viewer-ust">
          <div className="min-w-0">
            <b id="viewer-baslik">{evrak.ad}</b>
            <span>
              {evrak.adet} künye · {new Date(evrak.yuklemeZamani).toLocaleString("tr-TR")}
            </span>
          </div>
          <div className="viewer-araclar">
            {icerik?.tur === "pdf" && (
              <div className="viewer-zoom" role="group" aria-label="Yakınlaştırma">
                <button type="button" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Uzaklaştır" disabled={zoom <= 0.5}>
                  −
                </button>
                <button type="button" onClick={() => setZoom(1)} title="Sığdır">
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Yakınlaştır" disabled={zoom >= 3}>
                  +
                </button>
              </div>
            )}
            <a className="viewer-indir" href={url}>
              İndir
            </a>
            <button type="button" ref={kapatBtn} className="viewer-kapat" onClick={kapat} aria-label="Kapat">
              ✕
            </button>
          </div>
        </div>

        <div className="viewer-govde">
          {hata && <div className="status err px-4">{hata}</div>}
          {!hata && !icerik && <div className="viewer-ilerleme">Evrak yükleniyor...</div>}
          {icerik?.tur === "pdf" && <PdfSayfalar data={icerik.data} zoom={zoom} />}
          {icerik?.tur === "html" && (
            <iframe title={evrak.ad} className="viewer-html" sandbox="" srcDoc={icerik.html} referrerPolicy="no-referrer" />
          )}
          {icerik?.tur === "csv" && (
            <div className="viewer-csv">
              <table>
                <tbody>
                  {icerik.satirlar.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
