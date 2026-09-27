"use client";
import { useState } from "react";
import type { Me } from "@/lib/types";
import SifreDegistir from "./SifreDegistir";

async function logout() {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch {}
  location.href = "/login";
}

/** Sayfa başlığı + sağ üstte kullanıcı bağlantıları (Yönetim / Arşiv, Şifremi değiştir, Çıkış). */
export default function UstBar({ me, sayfa, baslik, aciklama }: {
  me: Me;
  sayfa: "arsiv" | "yonetim";
  baslik?: string;
  aciklama?: string;
}) {
  const [sifreAcik, setSifreAcik] = useState(false);
  return (
    <header>
      <div className="wrap !p-0 flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h1>{baslik ?? "🏷️ Künye Arşivi"}</h1>
          <p>{aciklama ?? "Manav ürün künyelerini arşivleyin, arayın, A4 şablona ekleyip yazdırın."}</p>
        </div>
        <nav className="ust-menu" aria-label="Kullanıcı menüsü">
          <span
            className="opacity-50"
            title={`Sürüm ${me.version}${me.commit ? ", commit " + me.commit : ""}\nServis başlangıcı: ${new Date(me.startedAt).toLocaleString("tr-TR")}`}
          >
            v{me.version}
            {me.commit ? " · " + me.commit : ""}
          </span>
          <span className="ust-kullanici">
            {me.username}
            <span className={"rol-rozet " + me.rol}>{me.rol === "yonetici" ? "Yönetici" : "Personel"}</span>
          </span>
          {sayfa === "arsiv" && me.rol === "yonetici" && <a href="/yonetim">Yönetim</a>}
          {sayfa === "yonetim" && <a href="/">← Arşiv</a>}
          <button type="button" onClick={() => setSifreAcik(true)}>
            Şifremi değiştir
          </button>
          <button type="button" onClick={logout}>
            Çıkış
          </button>
        </nav>
      </div>
      {sifreAcik && <SifreDegistir onClose={() => setSifreAcik(false)} />}
    </header>
  );
}
