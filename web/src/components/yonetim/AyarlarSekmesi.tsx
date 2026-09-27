"use client";
import { useEffect, useState } from "react";
import { api, postJson } from "@/lib/api";
import type { Ayarlar } from "@/lib/types";

const ALANLAR: { k: keyof Ayarlar; ad: string; aciklama: string; min: number; max: number }[] = [
  {
    k: "eksikGunPenceresi",
    ad: "Eksik evrak penceresi (gün)",
    aciklama: "Ana sayfadaki \"evrakı yüklenmemiş gün\" uyarısı bu kadar gün geriye bakar (bugün hariç).",
    min: 7,
    max: 120,
  },
  {
    k: "tazelikEskiGun",
    ad: "Sarı uyarı (gün)",
    aciklama: "Bildirimi bu kadar gün geçmiş künye sarı \"eski\" işareti alır.",
    min: 1,
    max: 365,
  },
  {
    k: "tazelikCokEskiGun",
    ad: "Kırmızı uyarı (gün)",
    aciklama: "Bildirimi bu kadar gün geçmiş künye kırmızı işaret alır. Sarı eşikten büyük olmalı.",
    min: 2,
    max: 730,
  },
  {
    k: "temizlikGun",
    ad: "Temizlik süresi (gün)",
    aciklama: "Bakım temizliği bildirimi bu kadar günden eski künyeleri siler.",
    min: 30,
    max: 3650,
  },
];

export default function AyarlarSekmesi() {
  const [kayitli, setKayitli] = useState<Ayarlar | null>(null);
  const [form, setForm] = useState<Record<keyof Ayarlar, string> | null>(null);
  const [msg, setMsg] = useState<{ t: string; ok?: boolean }>({ t: "" });
  const [busy, setBusy] = useState(false);

  const doldur = (a: Ayarlar) => {
    setKayitli(a);
    setForm(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v)])) as Record<keyof Ayarlar, string>);
  };

  useEffect(() => {
    api<Ayarlar>("/api/ayarlar")
      .then(doldur)
      .catch((e) => setMsg({ t: "Ayarlar okunamadı: " + (e as Error).message }));
  }, []);

  if (!form || !kayitli) {
    return msg.t ? <div className="status err">{msg.t}</div> : <div className="skel h-64 w-full" />;
  }

  const degisen = ALANLAR.filter((a) => form[a.k] !== String(kayitli[a.k]));

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg({ t: "" });
    try {
      const body = Object.fromEntries(degisen.map((a) => [a.k, Number(form![a.k])]));
      const yeni = await api<Ayarlar>("/api/admin/ayarlar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      doldur(yeni);
      setMsg({ t: "Ayarlar kaydedildi. Ana sayfada yenileyince geçerli olur.", ok: true });
    } catch (err) {
      setMsg({ t: (err as Error).message });
    }
    setBusy(false);
  }

  return (
    <>
      <form className="panel" onSubmit={kaydet}>
        <h2>🔧 Ayarlar</h2>
        <div className="ayar-liste">
          {ALANLAR.map((a) => (
            <label key={a.k} className="ayar">
              <span className="ayar-metin">
                <b>{a.ad}</b>
                <small>{a.aciklama}</small>
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={a.min}
                max={a.max}
                required
                value={form[a.k]}
                onChange={(e) => setForm({ ...form, [a.k]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <div className="form-satir !items-center">
          <button type="submit" className="savebtn" disabled={busy || degisen.length === 0}>
            Kaydet
          </button>
          {degisen.length > 0 && (
            <button type="button" className="metin-btn" onClick={() => doldur(kayitli)}>
              Değişiklikleri geri al
            </button>
          )}
        </div>
        <div className={"status" + (msg.t ? (msg.ok ? " ok" : " err") : "")} role="status">
          {msg.t}
        </div>
      </form>
      <Bakim gun={kayitli.temizlikGun} />
    </>
  );
}

function Bakim({ gun }: { gun: number }) {
  const [msg, setMsg] = useState<{ t: string; ok?: boolean }>({ t: "" });
  const [busy, setBusy] = useState(false);

  async function temizle() {
    if (!confirm(`Bildirimi ${gun} günden eski künyeler arşivden silinsin mi? Bu işlem geri alınamaz.`)) return;
    setBusy(true);
    setMsg({ t: "Temizleniyor..." });
    try {
      const r = await postJson<{ deleted: number }>("/api/kunyeler/cleanup", {});
      setMsg({ t: `${r.deleted} eski künye silindi.`, ok: true });
    } catch (e) {
      setMsg({ t: "Temizlik başarısız: " + (e as Error).message });
    }
    setBusy(false);
  }

  return (
    <div className="panel">
      <h2>🧹 Bakım</h2>
      <p className="yardim">
        Bildirimi <b>{gun} günden</b> eski künyeleri ve künyesi kalmayan evrakları (orijinal dosyalarıyla) siler. Bildirim
        tarihi okunamayan künyelere dokunmaz. Kayıtlı listelerden de düşerler.
      </p>
      <button type="button" className="tehlike-btn" disabled={busy} onClick={() => void temizle()}>
        {gun} günden eski kayıtları temizle
      </button>
      <div className={"status" + (msg.t ? (msg.ok ? " ok" : msg.t.endsWith("...") ? "" : " err") : "")} role="status">
        {msg.t}
      </div>
    </div>
  );
}
