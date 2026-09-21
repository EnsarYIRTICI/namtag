"use client";
import type { Kunye } from "@/lib/types";

interface Props {
  selected: Kunye[];
  onRemove: (no: string) => void;
  onClear: () => void;
}

export default function SelectedPanel({ selected, onRemove, onClear }: Props) {
  return (
    <div className="panel">
      <h2>
        🧾 Seçili Künyeler <span className="badge">{selected.length}</span>
      </h2>
      <div className="sel-list">
        {selected.length === 0 && <div className="empty">Henüz künye eklenmedi. Soldan &quot;Ekle&quot; ile ekleyin.</div>}
        {selected.map((r) => (
          <div className="sel-item" key={r.kunyeNo}>
            <span>{r.urun}</span>
            <button type="button" className="x" aria-label={r.urun + " künyesini kaldır"} onClick={() => onRemove(r.kunyeNo)}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="printbtn" disabled={selected.length === 0} onClick={() => window.print()}>
        🖨️ A4 Yazdır
      </button>
      <button type="button" className="clearbtn" onClick={onClear}>
        Seçilenleri temizle
      </button>
    </div>
  );
}
