"use client";
import { api } from "@/lib/api";
import type { Evrak } from "@/lib/types";
import type { Status } from "./Dashboard";

interface Props {
  evraklar: Evrak[];
  setStatus: (s: Status) => void;
  onChanged: () => Promise<void>;
}

function fmtSize(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

export default function EvrakPanel({ evraklar, setStatus, onChanged }: Props) {
  async function remove(e: Evrak) {
    const ad = e.ad || "(adsız evrak)";
    const ek = e.dosyaVar ? " Arşivlenmiş orijinal dosya da silinir." : "";
    if (!confirm(`"${ad}" evrağından yüklenen ${e.adet} künyenin hepsi arşivden silinsin mi?${ek} Bu işlem geri alınamaz.`)) return;
    try {
      const data = await api<{ deleted: number }>(`/api/evraklar/${e.id}`, { method: "DELETE" });
      await onChanged();
      setStatus({ msg: data.deleted + " künye silindi.", cls: "ok" });
    } catch (err) {
      setStatus({ msg: "Evrak silinemedi: " + (err as Error).message, cls: "err" });
    }
  }

  return (
    <div className="panel">
      <h2>
        📄 Yüklenen Evraklar <span className="badge">{evraklar.length}</span>
      </h2>
      <div className="evrak-list">
        {evraklar.length === 0 && <div className="empty">Henüz evrak yüklenmedi.</div>}
        {evraklar.map((e) => (
          <div className="evrak-item" key={e.id}>
            <div className="evrak-info">
              <b>{e.ad || "(evrak adı kayıtlı değil)"}</b>
              <span>
                {e.adet} künye · {new Date(e.yuklemeZamani).toLocaleString("tr-TR")}
                {e.dosyaVar && e.boyut != null ? " · " + fmtSize(e.boyut) : ""}
              </span>
            </div>
            <div className="evrak-actions">
              {e.dosyaVar && (
                <a className="dl" href={`/api/evraklar/${e.id}/dosya`} title="Yüklenen orijinal dosyayı indir">
                  İndir
                </a>
              )}
              <button type="button" className="del" onClick={() => void remove(e)}>
                Evrağı sil
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
