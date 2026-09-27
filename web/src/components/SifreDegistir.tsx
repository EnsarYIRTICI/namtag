"use client";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/api";

/** Kendi şifresini değiştirme penceresi. Diğer cihazlardaki oturumlar kapanır, bu cihazda oturum sürer. */
export default function SifreDegistir({ onClose }: { onClose: () => void }) {
  const [mevcut, setMevcut] = useState("");
  const [yeni, setYeni] = useState("");
  const [tekrar, setTekrar] = useState("");
  const [msg, setMsg] = useState<{ t: string; ok?: boolean }>({ t: "" });
  const [busy, setBusy] = useState(false);
  const ilk = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ilk.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    if (yeni.length < 10) return setMsg({ t: "Yeni şifre en az 10 karakter olmalı." });
    if (yeni !== tekrar) return setMsg({ t: "Yeni şifreler eşleşmiyor." });
    setBusy(true);
    setMsg({ t: "" });
    try {
      await postJson("/api/me/sifre", { mevcut, yeni });
      setMsg({ t: "Şifre değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.", ok: true });
      setMevcut("");
      setYeni("");
      setTekrar("");
    } catch (err) {
      setMsg({ t: (err as Error).message });
    }
    setBusy(false);
  }

  return (
    <div className="modal-arka" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="sifre-baslik" onSubmit={kaydet}>
        <div className="modal-ust">
          <h2 id="sifre-baslik">Şifremi değiştir</h2>
          <button type="button" className="viewer-kapat" aria-label="Kapat" onClick={onClose}>
            ✕
          </button>
        </div>
        <label className="alan">
          <span>Mevcut şifre</span>
          <input ref={ilk} type="password" autoComplete="current-password" value={mevcut} onChange={(e) => setMevcut(e.target.value)} />
        </label>
        <label className="alan">
          <span>Yeni şifre (en az 10 karakter)</span>
          <input type="password" autoComplete="new-password" value={yeni} onChange={(e) => setYeni(e.target.value)} />
        </label>
        <label className="alan">
          <span>Yeni şifre (tekrar)</span>
          <input type="password" autoComplete="new-password" value={tekrar} onChange={(e) => setTekrar(e.target.value)} />
        </label>
        <button className="printbtn" type="submit" disabled={busy || !mevcut || !yeni || !tekrar}>
          Şifreyi değiştir
        </button>
        <div className={"status" + (msg.t ? (msg.ok ? " ok" : " err") : "")} role="alert">
          {msg.t}
        </div>
      </form>
    </div>
  );
}
