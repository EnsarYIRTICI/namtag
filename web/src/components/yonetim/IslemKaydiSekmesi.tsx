"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ISLEM_ETIKET, ONEMLI_ISLEMLER, islemDetay } from "@/lib/islemler";
import type { IslemKaydi, Kullanici } from "@/lib/types";

const SAYFA = 50;

export default function IslemKaydiSekmesi({ surum }: { surum: number }) {
  const [kullanici, setKullanici] = useState("");
  const [islem, setIslem] = useState("");
  const [kayitlar, setKayitlar] = useState<IslemKaydi[] | null>(null);
  const [dahaVar, setDahaVar] = useState(false);
  const [kullanicilar, setKullanicilar] = useState<string[]>([]);
  const [hata, setHata] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Kullanici[]>("/api/admin/kullanicilar")
      .then((l) => setKullanicilar(l.map((u) => u.username)))
      .catch(() => {});
  }, [surum]);

  const getir = useCallback(
    async (once?: string) => {
      setBusy(true);
      setHata("");
      const q = new URLSearchParams({ limit: String(SAYFA) });
      if (kullanici) q.set("kullanici", kullanici);
      if (islem) q.set("islem", islem);
      if (once) q.set("once", once);
      try {
        const r = await api<{ items: IslemKaydi[]; dahaVar: boolean }>("/api/admin/islemler?" + q);
        setKayitlar((prev) => (once && prev ? [...prev, ...r.items] : r.items));
        setDahaVar(r.dahaVar);
      } catch (e) {
        setHata("İşlem kaydı okunamadı: " + (e as Error).message);
      }
      setBusy(false);
    },
    [kullanici, islem],
  );

  useEffect(() => {
    void getir();
  }, [getir, surum]);

  return (
    <div className="panel">
      <h2>📜 İşlem kaydı</h2>
      <p className="yardim">Kim, ne zaman, ne yaptı. Kayıtlar 1 yıl saklanır. Arama ve yazdırma kaydedilmez.</p>
      <div className="filtre-satir">
        <label className="alan dar">
          <span>Kullanıcı</span>
          <select value={kullanici} onChange={(e) => setKullanici(e.target.value)}>
            <option value="">Hepsi</option>
            {kullanicilar.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="alan dar">
          <span>İşlem</span>
          <select value={islem} onChange={(e) => setIslem(e.target.value)}>
            <option value="">Hepsi</option>
            {Object.entries(ISLEM_ETIKET).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="savebtn self-end" disabled={busy} onClick={() => void getir()}>
          Yenile
        </button>
      </div>
      {hata && <div className="status err">{hata}</div>}
      {!kayitlar ? (
        <div className="skel h-40 w-full" />
      ) : kayitlar.length === 0 ? (
        <div className="empty">Bu filtreye uyan kayıt yok.</div>
      ) : (
        <div className="tablo-kap">
          <table className="tablo kartli">
            <thead>
              <tr>
                <th>Zaman</th>
                <th>Kullanıcı</th>
                <th>İşlem</th>
                <th>Ayrıntı</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {kayitlar.map((k) => (
                <tr key={k.id} className={ONEMLI_ISLEMLER.has(k.islem) ? "onemli" : ""}>
                  <td data-etiket="Zaman" className="whitespace-nowrap">{new Date(k.zaman).toLocaleString("tr-TR")}</td>
                  <td data-etiket="Kullanıcı">{k.kullanici ?? "—"}</td>
                  <td data-etiket="İşlem" className="islem whitespace-nowrap">{ISLEM_ETIKET[k.islem] ?? k.islem}</td>
                  <td data-etiket="Ayrıntı" className="ayrinti">{islemDetay(k)}</td>
                  <td data-etiket="IP" className="ip">{k.ip ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dahaVar && (
        <button type="button" className="clearbtn" disabled={busy} onClick={() => void getir(kayitlar?.at(-1)?.id)}>
          Daha eski kayıtları göster
        </button>
      )}
    </div>
  );
}
