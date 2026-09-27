"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import UstBar from "../UstBar";
import AyarlarSekmesi from "./AyarlarSekmesi";
import IslemKaydiSekmesi from "./IslemKaydiSekmesi";
import IstatistikSekmesi from "./IstatistikSekmesi";
import KullanicilarSekmesi from "./KullanicilarSekmesi";

const SEKMELER = [
  { id: "kullanicilar", ad: "Kullanıcılar" },
  { id: "islemler", ad: "İşlem kaydı" },
  { id: "istatistik", ad: "İstatistikler" },
  { id: "ayarlar", ad: "Ayarlar" },
] as const;
type SekmeId = (typeof SEKMELER)[number]["id"];

const hashSekme = (): SekmeId => {
  const h = typeof location === "undefined" ? "" : location.hash.slice(1);
  return (SEKMELER.find((s) => s.id === h)?.id ?? "kullanicilar") as SekmeId;
};

/** Yönetim paneli. Yönetici olmayan kullanıcı ana sayfaya döner (sunucu da her uçta ayrıca kontrol eder). */
export default function Yonetim() {
  const [me, setMe] = useState<Me | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [sekme, setSekme] = useState<SekmeId>("kullanicilar");
  // Kullanıcı listesi değişince işlem kaydındaki kullanıcı filtresi de tazelensin
  const [surum, setSurum] = useState(0);
  const degisti = useCallback(() => setSurum((v) => v + 1), []);

  useEffect(() => {
    setSekme(hashSekme());
    const onHash = () => setSekme(hashSekme());
    window.addEventListener("hashchange", onHash);
    api<Me>("/api/me")
      .then((m) => {
        if (m.rol !== "yonetici") {
          location.replace("/");
          return;
        }
        setMe(m);
      })
      .catch((e: Error & { status?: number }) => {
        if (e.status !== 401) setHata(e.message);
      });
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (!me) {
    return (
      <div className="wrap">
        {hata ? <div className="status err">Yüklenemedi: {hata}</div> : <div className="skel h-8 w-48" aria-label="Yükleniyor" />}
      </div>
    );
  }

  return (
    <div>
      <UstBar me={me} sayfa="yonetim" baslik="⚙️ Yönetim" aciklama="Kullanıcılar, işlem kaydı, istatistikler ve ayarlar." />
      <div className="wrap">
        <div className="sekmeler" role="tablist">
          {SEKMELER.map((s) => (
            <a
              key={s.id}
              href={"#" + s.id}
              role="tab"
              aria-selected={sekme === s.id}
              className={sekme === s.id ? "aktif" : ""}
            >
              {s.ad}
            </a>
          ))}
        </div>
        <div role="tabpanel">
          {sekme === "kullanicilar" && <KullanicilarSekmesi me={me} onDegisti={degisti} />}
          {sekme === "islemler" && <IslemKaydiSekmesi surum={surum} />}
          {sekme === "istatistik" && <IstatistikSekmesi />}
          {sekme === "ayarlar" && <AyarlarSekmesi />}
        </div>
      </div>
    </div>
  );
}
