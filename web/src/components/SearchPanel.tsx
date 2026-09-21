"use client";
import { useMemo, useState } from "react";
import type { Kunye } from "@/lib/types";
import { parseTRDateTime, trUpper } from "@/lib/tr";

interface Props {
  records: Kunye[];
  selected: Kunye[];
  onAdd: (k: Kunye) => void;
}

export default function SearchPanel({ records, selected, onAdd }: Props) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = trUpper(query.trim());
    if (!q) return null;
    return records
      .filter((r) => trUpper(r.urun).includes(q))
      .sort((a, b) => parseTRDateTime(b.bildirimTarihi) - parseTRDateTime(a.bildirimTarihi))
      .slice(0, 20);
  }, [records, query]);

  return (
    <div className="panel">
      <h2>
        🔍 Ürün Ara <span className="badge">{records.length}</span>
      </h2>
      <div className="search-box">
        <input
          type="text"
          placeholder="örn: domates, limon, şeftali..."
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="results">
        {matches === null && <div className="empty">Aramaya başlamak için ürün adı yazın.</div>}
        {matches !== null && matches.length === 0 && <div className="empty">Eşleşen künye bulunamadı.</div>}
        {matches?.map((r) => {
          const already = selected.some((s) => s.kunyeNo === r.kunyeNo);
          return (
            <div className="rcard" key={r.kunyeNo}>
              <div className="rinfo">
                <b>{r.urun}</b>
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
      </div>
    </div>
  );
}
