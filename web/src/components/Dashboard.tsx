"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, postJson } from "@/lib/api";
import type { Bekleyen, Eksikler, Evrak, Kunye, Liste, Me } from "@/lib/types";
import Bildirimler from "./Bildirimler";
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
  const [toplamKunye, setToplamKunye] = useState(0);
  const [arsivSurumu, setArsivSurumu] = useState(0);
  const [evraklar, setEvraklar] = useState<Evrak[]>([]);
  const [listeler, setListeler] = useState<Liste[]>([]);
  const [selected, setSelected] = useState<Kunye[]>([]);
  const [bekleyenler, setBekleyenler] = useState<Bekleyen[]>([]);
  const [eksikler, setEksikler] = useState<Eksikler | null>(null);
  const [aktifListe, setAktifListe] = useState<Liste | null>(null);
  const [status, setStatus] = useState<Status>({ msg: "", cls: "" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const selectedRef = useRef<Kunye[]>([]);
  selectedRef.current = selected;

  /** Seçili künyelerden arşivden silinmiş olanları atar (evrak silme / temizlik sonrası). */
  const pruneSelected = useCallback(async () => {
    const cur = selectedRef.current;
    if (cur.length === 0) return;
    // Güncel halini al: silinenler düşer, tazelik işaretleri (en yeni / eski) tazelenir
    const fresh = new Map(
      (await postJson<Kunye[]>("/api/kunyeler/bul", { kunyeNos: cur.map((s) => s.kunyeNo) })).map((k) => [k.kunyeNo, k]),
    );
    setSelected((prev) => prev.filter((s) => fresh.has(s.kunyeNo)).map((s) => fresh.get(s.kunyeNo)!));
  }, []);

  // Tüm arşiv indirilmez: sadece toplam sayı, evrak listesi ve kayıtlı listeler. Arama sunucuda yapılır.
  const loadAll = useCallback(async () => {
    try {
      const [o, e, l, x] = await Promise.all([
        api<{ toplam: number }>("/api/kunyeler/ozet"),
        api<Evrak[]>("/api/evraklar"),
        api<Liste[]>("/api/listeler"),
        api<Eksikler>("/api/eksikler"),
        pruneSelected(),
      ]);
      setToplamKunye(o.toplam);
      setEvraklar(e);
      setListeler(l);
      setEksikler(x);
      // Açık listedeki bekleyenlerin adaylarını tazele (kaydedilmemiş düzenlemeler korunur)
      const adaylar = new Map(l.flatMap((li) => li.bekleyenler).map((b) => [b.id, b.adaylar]));
      setBekleyenler((prev) => prev.map((b) => (b.id && adaylar.has(b.id) ? { ...b, adaylar: adaylar.get(b.id) } : b)));
      setArsivSurumu((v) => v + 1);
      // Açık liste başka cihazdan silindiyse bağlantıyı kopar; güncellendiyse son halini al
      setAktifListe((prev) => (prev ? (l.find((x) => x.id === prev.id) ?? null) : null));
    } catch (err) {
      setStatus({ msg: "Arşiv okunamadı: " + errMsg(err), cls: "err" });
    }
  }, [pruneSelected]);

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
    const imza = (nos: string[], bs: Bekleyen[]) =>
      JSON.stringify([nos, bs.map((b) => [b.id ?? "", b.urun, b.aciklama])]);
    if (!aktifListe) return selected.length > 0 || bekleyenler.length > 0;
    return imza(selected.map((s) => s.kunyeNo), bekleyenler) !== imza(aktifListe.kunyeNos, aktifListe.bekleyenler);
  }, [selected, bekleyenler, aktifListe]);

  const addSelected = (rec: Kunye) =>
    setSelected((prev) => (prev.some((s) => s.kunyeNo === rec.kunyeNo) ? prev : [...prev, rec]));
  const removeSelected = (no: string) => setSelected((prev) => prev.filter((s) => s.kunyeNo !== no));

  function clearSelected() {
    if (dirty && !confirm("Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?")) return;
    setSelected([]);
    setBekleyenler([]);
    setAktifListe(null);
  }

  function bekleyenEkle(urun: string) {
    const t = urun.trim();
    if (!t) return;
    setBekleyenler((prev) =>
      prev.some((b) => b.urun.toLocaleLowerCase("tr-TR") === t.toLocaleLowerCase("tr-TR")) ? prev : [...prev, { urun: t, aciklama: "" }],
    );
  }
  const bekleyenSil = (i: number) => setBekleyenler((prev) => prev.filter((_, j) => j !== i));

  /** Bekleyen satırı gelen künyeyle değiştirir (listeye künyeyi ekler, satırı kaldırır). */
  async function eslestir(eslesmeler: { index: number; kunyeNo: string }[]) {
    try {
      const items = await postJson<Kunye[]>("/api/kunyeler/bul", { kunyeNos: eslesmeler.map((e) => e.kunyeNo) });
      setSelected((prev) => [...prev, ...items.filter((k) => !prev.some((s) => s.kunyeNo === k.kunyeNo))]);
      const kaldir = new Set(eslesmeler.filter((e) => items.some((k) => k.kunyeNo === e.kunyeNo)).map((e) => e.index));
      setBekleyenler((prev) => prev.filter((_, j) => !kaldir.has(j)));
    } catch (e) {
      alert("Künye eklenemedi: " + errMsg(e));
    }
  }

  /** Yeni liste oluşturur ya da açık listeyi günceller. Hata varsa mesajını döner. */
  async function saveList(ad: string): Promise<string | null> {
    const body = {
      ad,
      kunyeNos: selected.map((s) => s.kunyeNo),
      bekleyenler: bekleyenler.map(({ id, urun, aciklama }) => ({ id, urun, aciklama })),
    };
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
      setBekleyenler(saved.bekleyenler);
      return null;
    } catch (e) {
      return "Kaydedilemedi: " + errMsg(e);
    }
  }

  async function openList(l: Liste) {
    if (dirty && !confirm("Seçili künyelerde kaydedilmemiş değişiklik var. Yine de listeyi açalım mı?")) return;
    try {
      const items = l.kunyeNos.length ? await postJson<Kunye[]>("/api/kunyeler/bul", { kunyeNos: l.kunyeNos }) : [];
      setSelected(items);
      setBekleyenler(l.bekleyenler);
      setAktifListe(l);
      requestAnimationFrame(() => document.getElementById("secili-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      alert("Liste açılamadı: " + errMsg(e));
    }
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

  async function muafIsaretle(gun: string) {
    try {
      await postJson("/api/eksikler/muaf", { gun });
      setEksikler(await api<Eksikler>("/api/eksikler"));
    } catch (e) {
      alert("İşaretlenemedi: " + errMsg(e));
    }
  }
  async function muafGeriAl(gun: string) {
    try {
      await api(`/api/eksikler/muaf/${gun}`, { method: "DELETE" });
      setEksikler(await api<Eksikler>("/api/eksikler"));
    } catch (e) {
      alert("Geri alınamadı: " + errMsg(e));
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

        <Bildirimler
          eksikler={eksikler}
          listeler={listeler}
          aktifId={aktifListe?.id ?? null}
          onMuaf={muafIsaretle}
          onMuafGeriAl={muafGeriAl}
          onListeAc={(l) => void openList(l)}
        />

        {/* Telefonda tek sütun ve sıra: Ara → Seçili → Kayıtlı listeler → Yükle → Evraklar.
            Bilgisayarda iki sütun (sol: yükle/evrak/ara, sağ: seçili/listeler). */}
        <div className="wrap">
          <div className="layout-grid">
            <div className="contents md:block">
              <div className="order-4 md:order-none">
                <UploadPanel status={status} setStatus={setStatus} onChanged={loadAll} />
              </div>
              <div className="order-5 md:order-none">
                <EvrakPanel evraklar={evraklar} setStatus={setStatus} onChanged={loadAll} />
              </div>
              <div className="order-1 md:order-none">
                <SearchPanel
                  toplam={toplamKunye}
                  selected={selected}
                  onAdd={addSelected}
                  refreshKey={arsivSurumu}
                  onBekleyenEkle={bekleyenEkle}
                  bekleyenAdlari={bekleyenler.map((b) => b.urun.toLocaleLowerCase("tr-TR"))}
                />
              </div>
            </div>
            <div className="contents md:block">
              <div className="order-2 md:order-none">
                <SelectedPanel
                  selected={selected}
                  bekleyenler={bekleyenler}
                  aktifListe={aktifListe}
                  dirty={dirty}
                  onRemove={removeSelected}
                  onBekleyenSil={bekleyenSil}
                  onEslestir={(i, a) => eslestir([{ index: i, kunyeNo: a.kunyeNo }])}
                  onTumunuEslestir={() =>
                    eslestir(
                      bekleyenler.flatMap((b, i) => (b.adaylar?.length === 1 ? [{ index: i, kunyeNo: b.adaylar[0]!.kunyeNo }] : [])),
                    )
                  }
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
        <MobileBar count={selected.length} bekleyen={bekleyenler.length} dirty={dirty} />
      </div>
      <PrintArea selected={selected} />
    </>
  );
}
