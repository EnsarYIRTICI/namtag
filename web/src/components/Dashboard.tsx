"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, postJson } from "@/lib/api";
import type { Evrak, Kunye, Liste, Me } from "@/lib/types";
import EvrakPanel from "./EvrakPanel";
import ListelerPanel from "./ListelerPanel";
import LoadingScreen from "./LoadingScreen";
import MobileBar from "./MobileBar";
import PrintArea from "./PrintArea";
import SearchPanel from "./SearchPanel";
import SelectedPanel from "./SelectedPanel";
import UploadPanel from "./UploadPanel";

export interface Status {
  msg: string;
  cls: "" | "ok" | "err";
}

const errMsg = (e: unknown) => (e instanceof TypeError ? "Sunucuya ulaşılamıyor" : (e as Error).message || "Bilinmeyen hata");

export default function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [records, setRecords] = useState<Kunye[]>([]);
  const [evraklar, setEvraklar] = useState<Evrak[]>([]);
  const [listeler, setListeler] = useState<Liste[]>([]);
  const [selected, setSelected] = useState<Kunye[]>([]);
  const [aktifListe, setAktifListe] = useState<Liste | null>(null);
  const [status, setStatus] = useState<Status>({ msg: "", cls: "" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const recordsRef = useRef<Kunye[]>([]);

  const loadAll = useCallback(async () => {
    try {
      const [k, e, l] = await Promise.all([
        api<Kunye[]>("/api/kunyeler"),
        api<Evrak[]>("/api/evraklar"),
        api<Liste[]>("/api/listeler"),
      ]);
      recordsRef.current = k;
      setRecords(k);
      setEvraklar(e);
      setListeler(l);
      // Arşivden silinmiş künyeler seçili listede kalmasın
      const alive = new Set(k.map((r) => r.kunyeNo));
      setSelected((prev) => prev.filter((s) => alive.has(s.kunyeNo)));
      // Açık liste başka cihazdan silindiyse bağlantıyı kopar; güncellendiyse son halini al
      setAktifListe((prev) => (prev ? (l.find((x) => x.id === prev.id) ?? null) : null));
      return k;
    } catch (err) {
      setStatus({ msg: "Arşiv okunamadı: " + errMsg(err), cls: "err" });
      return null;
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
        setLoadError(errMsg(err));
      });
  }, [loadAll]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  // Sekmeye geri dönülünce yenile: telefondan kaydedilen liste bilgisayarda sayfayı yenilemeden görünsün
  useEffect(() => {
    if (!me) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [me, loadAll]);

  const dirty = useMemo(() => {
    const cur = selected.map((s) => s.kunyeNo).join(",");
    if (!aktifListe) return selected.length > 0;
    return cur !== aktifListe.kunyeNos.join(",");
  }, [selected, aktifListe]);

  const addSelected = (rec: Kunye) =>
    setSelected((prev) => (prev.some((s) => s.kunyeNo === rec.kunyeNo) ? prev : [...prev, rec]));
  const removeSelected = (no: string) => setSelected((prev) => prev.filter((s) => s.kunyeNo !== no));

  function clearSelected() {
    if (dirty && selected.length > 0 && !confirm("Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?")) return;
    setSelected([]);
    setAktifListe(null);
  }

  /** Yeni liste oluşturur ya da açık listeyi günceller. Hata varsa mesajını döner. */
  async function saveList(ad: string): Promise<string | null> {
    const body = { ad, kunyeNos: selected.map((s) => s.kunyeNo) };
    try {
      const saved = aktifListe
        ? await api<Liste>(`/api/listeler/${aktifListe.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await postJson<Liste>("/api/listeler", body);
      setAktifListe(saved);
      setListeler((prev) => [saved, ...prev.filter((x) => x.id !== saved.id)]);
      // Sunucu arşivde olmayanları atlamış olabilir: seçimi kayıtla eşitle
      const keep = new Set(saved.kunyeNos);
      setSelected((prev) => prev.filter((s) => keep.has(s.kunyeNo)));
      return null;
    } catch (e) {
      return "Kaydedilemedi: " + errMsg(e);
    }
  }

  async function openList(l: Liste) {
    if (dirty && selected.length > 0 && !confirm("Seçili künyelerde kaydedilmemiş değişiklik var. Yine de listeyi açalım mı?")) return;
    let pool = recordsRef.current;
    // Liste, bu cihaz arşivi yükledikten sonra eklenen künyeleri içeriyorsa önce arşivi tazele
    if (l.kunyeNos.some((no) => !pool.some((r) => r.kunyeNo === no))) pool = (await loadAll()) ?? pool;
    const byNo = new Map(pool.map((r) => [r.kunyeNo, r]));
    setSelected(l.kunyeNos.map((no) => byNo.get(no)).filter((r): r is Kunye => !!r));
    setAktifListe(l);
    requestAnimationFrame(() => document.getElementById("secili-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function deleteList(l: Liste): Promise<string | null> {
    try {
      await api(`/api/listeler/${l.id}`, { method: "DELETE" });
      setListeler((prev) => prev.filter((x) => x.id !== l.id));
      if (aktifListe?.id === l.id) setAktifListe(null); // seçim ekranda kalır, istenirse yeniden kaydedilebilir
      return null;
    } catch (e) {
      return "Liste silinemedi: " + errMsg(e);
    }
  }

  function print() {
    window.print();
    // Kaydedilmiş ve değiştirilmemiş liste yazdırıldıysa işaretle
    if (aktifListe && !dirty) {
      postJson<Liste>(`/api/listeler/${aktifListe.id}/yazdirildi`, {})
        .then((l) => {
          setAktifListe(l);
          setListeler((prev) => prev.map((x) => (x.id === l.id ? l : x)));
        })
        .catch(() => {});
    }
  }

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
      setStatus({ msg: "Temizlik başarısız: " + errMsg(e), cls: "err" });
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

        {/* Telefonda tek sütun ve sıra: Ara → Seçili → Kayıtlı listeler → Yükle → Evraklar.
            Bilgisayarda iki sütun (sol: yükle/evrak/ara, sağ: seçili/listeler). */}
        <div className="wrap">
          <div className="layout-grid">
            <div className="contents md:block">
              <div className="order-4 md:order-none">
                <UploadPanel status={status} setStatus={setStatus} onChanged={async () => void (await loadAll())} />
              </div>
              <div className="order-5 md:order-none">
                <EvrakPanel evraklar={evraklar} setStatus={setStatus} onChanged={async () => void (await loadAll())} />
              </div>
              <div className="order-1 md:order-none">
                <SearchPanel records={records} selected={selected} onAdd={addSelected} />
              </div>
            </div>
            <div className="contents md:block">
              <div className="order-2 md:order-none">
                <SelectedPanel
                  selected={selected}
                  aktifListe={aktifListe}
                  dirty={dirty}
                  onRemove={removeSelected}
                  onClear={clearSelected}
                  onSave={saveList}
                  onPrint={print}
                />
              </div>
              <div className="order-3 md:order-none">
                <ListelerPanel listeler={listeler} aktifId={aktifListe?.id ?? null} onOpen={(l) => void openList(l)} onDelete={deleteList} />
              </div>
              <div className="order-6 md:order-none">
                <button type="button" className="maint" onClick={cleanup}>
                  Bakım: 6 aydan eski kayıtları temizle
                </button>
              </div>
            </div>
          </div>
        </div>
        <MobileBar count={selected.length} dirty={dirty} />
      </div>
      <PrintArea selected={selected} />
    </>
  );
}
