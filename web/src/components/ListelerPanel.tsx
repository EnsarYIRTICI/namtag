"use client";
import { useState } from "react";
import type { Liste } from "@/lib/types";

interface Props {
  listeler: Liste[];
  aktifId: string | null;
  onOpen: (l: Liste) => void;
  onDelete: (l: Liste) => Promise<string | null>;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export default function ListelerPanel({ listeler, aktifId, onOpen, onDelete }: Props) {
  const [err, setErr] = useState("");

  return (
    <div className="panel">
      <h2>
        📋 Kayıtlı Listeler <span className="badge">{listeler.length}</span>
      </h2>
      <div className="liste-list">
        {listeler.length === 0 && (
          <div className="empty">
            Kayıtlı liste yok. Künyeleri seçip &quot;Listeyi kaydet&quot; dediğinde burada görünür; telefondan kaydettiğin
            listeyi bilgisayardan açıp yazdırabilirsin.
          </div>
        )}
        {listeler.map((l) => {
          const aktif = l.id === aktifId;
          return (
            <div className={"liste-item" + (aktif ? " aktif" : "")} key={l.id}>
              <div className="liste-info">
                <b>{l.ad}</b>
                <span>
                  {l.kunyeNos.length} künye
                  {l.bekleyenler.length ? ` + ${l.bekleyenler.length} bekleyen` : ""} · {fmt(l.guncelleme)}
                  {l.olusturan ? " · " + l.olusturan : ""}
                </span>
                {l.bekleyenler.some((b) => b.adaylar?.length) && (
                  <span className="geldi-not">
                    📬 {l.bekleyenler.filter((b) => b.adaylar?.length).length} bekleyen ürünün künyesi geldi
                  </span>
                )}
                <span className={l.sonYazdirma ? "yazdirildi" : "bekliyor"}>
                  {l.sonYazdirma ? "Yazdırıldı: " + fmt(l.sonYazdirma) : "Henüz yazdırılmadı"}
                </span>
              </div>
              <div className="liste-actions">
                {aktif ? (
                  <span className="acik">Açık</span>
                ) : (
                  <button type="button" className="ac" onClick={() => onOpen(l)}>
                    Aç
                  </button>
                )}
                <button
                  type="button"
                  className="sil"
                  aria-label={`"${l.ad}" listesini sil`}
                  onClick={async () => {
                    if (!confirm(`"${l.ad}" listesi silinsin mi? Künyeler arşivde kalır, sadece liste silinir.`)) return;
                    setErr((await onDelete(l)) ?? "");
                  }}
                >
                  Sil
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {err && <div className="status err">{err}</div>}
    </div>
  );
}
