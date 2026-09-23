"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson } from "@/lib/api";
import type { Evrak, Kunye, Me } from "@/lib/types";
import EvrakPanel from "./EvrakPanel";
import LoadingScreen from "./LoadingScreen";
import PrintArea from "./PrintArea";
import SearchPanel from "./SearchPanel";
import SelectedPanel from "./SelectedPanel";
import UploadPanel from "./UploadPanel";

export interface Status {
  msg: string;
  cls: "" | "ok" | "err";
}

export default function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [records, setRecords] = useState<Kunye[]>([]);
  const [evraklar, setEvraklar] = useState<Evrak[]>([]);
  const [selected, setSelected] = useState<Kunye[]>([]);
  const [status, setStatus] = useState<Status>({ msg: "", cls: "" });
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [k, e] = await Promise.all([api<Kunye[]>("/api/kunyeler"), api<Evrak[]>("/api/evraklar")]);
      setRecords(k);
      setEvraklar(e);
      // Arşivden silinmiş künyeler seçili listede kalmasın
      const alive = new Set(k.map((r) => r.kunyeNo));
      setSelected((prev) => prev.filter((s) => alive.has(s.kunyeNo)));
    } catch (err) {
      setStatus({ msg: "Arşiv okunamadı: " + (err as Error).message, cls: "err" });
    }
  }, []);

  const loadMe = useCallback(() => {
    setLoadError(null);
    api<Me>("/api/me")
      .then((m) => {
        setMe(m);
        return loadAll();
      })
      .catch((err: Error & { status?: number }) => {
        // 401'de api() zaten giriş sayfasına yönlendiriyor
        if (err.status === 401) return;
        // fetch ağ hatasında İngilizce "Failed to fetch" döner; kullanıcıya Türkçe göster
        setLoadError(err instanceof TypeError ? "Sunucuya ulaşılamıyor" : err.message || "Bilinmeyen hata");
      });
  }, [loadAll]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const addSelected = (rec: Kunye) =>
    setSelected((prev) => (prev.some((s) => s.kunyeNo === rec.kunyeNo) ? prev : [...prev, rec]));
  const removeSelected = (no: string) => setSelected((prev) => prev.filter((s) => s.kunyeNo !== no));

  async function logout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {}
    location.href = "/login";
  }

  async function cleanup() {
    if (!confirm("6 aydan eski künye kayıtları arşivden silinsin mi? Bu işlem geri alınamaz.")) return;
    setStatus({ msg: "Temizleniyor...", cls: "" });
    try {
      const data = await postJson<{ deleted: number }>("/api/kunyeler/cleanup", { days: 180 });
      setStatus({ msg: data.deleted + " eski kayıt silindi.", cls: "ok" });
      await loadAll();
    } catch (e) {
      setStatus({ msg: "Temizlik başarısız: " + (e as Error).message, cls: "err" });
    }
  }

  if (!me) {
    return <LoadingScreen error={loadError ?? undefined} onRetry={loadMe} />;
  }

  return (
    <>
      <div id="app-root">
        <header>
          <div className="wrap !p-0 flex justify-between items-start gap-3">
            <div>
              <h1>🏷️ Künye Arşivi</h1>
              <p>Manav ürün künyelerini arşivleyin, arayın, A4 şablona ekleyip yazdırın.</p>
            </div>
            <div className="text-right text-[12.5px] whitespace-nowrap">
              <span
                className="opacity-50 mr-2"
                title={`Sürüm ${me.version}${me.commit ? ", commit " + me.commit : ""}\nServis başlangıcı: ${new Date(me.startedAt).toLocaleString("tr-TR")}`}
              >
                v{me.version}
                {me.commit ? " · " + me.commit : ""}
              </span>
              <span className="opacity-65">{me.username}</span>
              <button type="button" onClick={logout} className="ml-2 bg-transparent border-0 p-0 cursor-pointer underline text-inherit font-[inherit]">
                Çıkış
              </button>
            </div>
          </div>
        </header>

        <div className="wrap">
          <div className="layout-grid">
            <div>
              <UploadPanel status={status} setStatus={setStatus} onChanged={loadAll} />
              <EvrakPanel evraklar={evraklar} setStatus={setStatus} onChanged={loadAll} />
              <SearchPanel records={records} selected={selected} onAdd={addSelected} />
            </div>
            <div>
              <SelectedPanel selected={selected} onRemove={removeSelected} onClear={() => setSelected([])} />
              <button type="button" className="maint" onClick={cleanup}>
                Bakım: 6 aydan eski kayıtları temizle
              </button>
            </div>
          </div>
        </div>
      </div>
      <PrintArea selected={selected} />
    </>
  );
}
