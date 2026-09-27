"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson } from "@/lib/api";
import type { Kullanici, Me, Rol } from "@/lib/types";

const zaman = (s: string | null) => (s ? new Date(s).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—");

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export default function KullanicilarSekmesi({ me, onDegisti }: { me: Me; onDegisti: () => void }) {
  const [liste, setListe] = useState<Kullanici[] | null>(null);
  const [msg, setMsg] = useState<{ t: string; ok?: boolean }>({ t: "" });
  const [mesgul, setMesgul] = useState<string | null>(null);
  const [sifreAcik, setSifreAcik] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    try {
      setListe(await api<Kullanici[]>("/api/admin/kullanicilar"));
    } catch (e) {
      setMsg({ t: "Kullanıcılar okunamadı: " + (e as Error).message });
    }
  }, []);
  useEffect(() => {
    void yukle();
  }, [yukle]);

  /** İşlemi çalıştırır, listeyi tazeler, sonucu mesaj olarak gösterir. */
  async function isle(username: string, f: () => Promise<unknown>, basari: string) {
    setMesgul(username);
    setMsg({ t: "" });
    try {
      await f();
      setMsg({ t: basari, ok: true });
      await yukle();
      onDegisti();
    } catch (e) {
      setMsg({ t: (e as Error).message });
    }
    setMesgul(null);
  }

  const rolDegistir = (u: Kullanici, rol: Rol) =>
    isle(u.username, () => api(`/api/admin/kullanicilar/${u.username}`, json("PATCH", { rol })),
      `${u.username} artık ${rol === "yonetici" ? "yönetici" : "personel"}.`);

  const aktiflik = (u: Kullanici) => {
    if (u.aktif && !confirm(`${u.username} pasifleştirilsin mi? Açık oturumları kapanır ve giriş yapamaz.`)) return;
    void isle(u.username, () => api(`/api/admin/kullanicilar/${u.username}`, json("PATCH", { aktif: !u.aktif })),
      `${u.username} ${u.aktif ? "pasifleştirildi" : "yeniden aktif"}.`);
  };

  const oturumKapat = (u: Kullanici) =>
    isle(u.username, () => postJson(`/api/admin/kullanicilar/${u.username}/oturumlari-kapat`, {}),
      `${u.username} kullanıcısının oturumları kapatıldı.`);

  const sil = (u: Kullanici) => {
    if (!confirm(`${u.username} kalıcı olarak silinsin mi? İşlem kaydındaki geçmişi kalır. Bu işlem geri alınamaz.`)) return;
    void isle(u.username, () => api(`/api/admin/kullanicilar/${u.username}`, { method: "DELETE" }), `${u.username} silindi.`);
  };

  return (
    <>
      <YeniKullanici onEklendi={async (ad) => { setMsg({ t: ad + " eklendi.", ok: true }); await yukle(); onDegisti(); }} />

      <div className="panel">
        <h2>
          👥 Kullanıcılar <span className="badge">{liste?.length ?? 0}</span>
        </h2>
        <p className="yardim">
          <b>Yönetici</b> her şeyi yapabilir. <b>Personel</b> evrak yükler, arar, liste hazırlar ve yazdırır; evrak/künye silemez,
          bakım temizliği ve bu paneli göremez.
        </p>
        <div className={"status" + (msg.t ? (msg.ok ? " ok" : " err") : "")} role="status">
          {msg.t}
        </div>
        {!liste ? (
          <div className="skel h-24 w-full" />
        ) : (
          <div className="tablo-kap">
            <table className="tablo kartli">
              <thead>
                <tr>
                  <th>Kullanıcı</th>
                  <th>Rol</th>
                  <th>Durum</th>
                  <th>Son giriş</th>
                  <th className="sayi">Açık oturum</th>
                  <th>Oluşturma</th>
                  <th aria-label="İşlemler" />
                </tr>
              </thead>
              <tbody>
                {liste.map((u) => {
                  const ben = u.username === me.username;
                  const kilit = ben || mesgul === u.username;
                  return (
                    <tr key={u.username} className={u.aktif ? "" : "pasif"}>
                      <td className="kart-baslik">
                        <b>{u.username}</b>
                        {ben && <span className="ben"> (siz)</span>}
                      </td>
                      <td data-etiket="Rol">
                        <select
                          value={u.rol}
                          disabled={kilit}
                          aria-label={u.username + " rolü"}
                          title={ben ? "Kendi rolünüzü değiştiremezsiniz" : undefined}
                          onChange={(e) => void rolDegistir(u, e.target.value as Rol)}
                        >
                          <option value="yonetici">Yönetici</option>
                          <option value="personel">Personel</option>
                        </select>
                      </td>
                      <td data-etiket="Durum">
                        <span className={"durum " + (u.aktif ? "aktif" : "pasif")}>{u.aktif ? "Aktif" : "Pasif"}</span>
                      </td>
                      <td data-etiket="Son giriş">{zaman(u.sonGiris)}</td>
                      <td data-etiket="Açık oturum" className="sayi">{u.acikOturum}</td>
                      <td data-etiket="Oluşturma">{zaman(u.createdAt)}</td>
                      <td className="kart-aksiyon">
                        <div className="satir-aksiyon">
                          <button type="button" disabled={kilit} onClick={() => setSifreAcik(u.username)}>
                            Şifre sıfırla
                          </button>
                          <button type="button" disabled={kilit || u.acikOturum === 0} onClick={() => void oturumKapat(u)}>
                            Oturumları kapat
                          </button>
                          <button type="button" disabled={kilit} onClick={() => aktiflik(u)}>
                            {u.aktif ? "Pasifleştir" : "Aktifleştir"}
                          </button>
                          <button type="button" className="tehlike" disabled={kilit} onClick={() => sil(u)}>
                            Sil
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sifreAcik && (
        <SifreSifirla
          username={sifreAcik}
          onClose={() => setSifreAcik(null)}
          onTamam={() => {
            setMsg({ t: `${sifreAcik} kullanıcısının şifresi değişti, açık oturumları kapatıldı.`, ok: true });
            setSifreAcik(null);
            void yukle();
            onDegisti();
          }}
        />
      )}
    </>
  );
}

function YeniKullanici({ onEklendi }: { onEklendi: (ad: string) => Promise<void> }) {
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [rol, setRol] = useState<Rol>("personel");
  const [hata, setHata] = useState("");
  const [busy, setBusy] = useState(false);

  async function ekle(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setHata("");
    try {
      await postJson("/api/admin/kullanicilar", { username, password, rol });
      const ad = username.trim().toLowerCase();
      setU("");
      setP("");
      setRol("personel");
      await onEklendi(ad);
    } catch (err) {
      setHata((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <form className="panel" onSubmit={ekle}>
      <h2>➕ Yeni kullanıcı</h2>
      <div className="form-satir">
        <label className="alan">
          <span>Kullanıcı adı</span>
          <input value={username} onChange={(e) => setU(e.target.value)} autoCapitalize="none" spellCheck={false}
            autoComplete="off" placeholder="örn. ayse" />
        </label>
        <label className="alan">
          <span>Şifre (en az 10 karakter)</span>
          <input type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="alan dar">
          <span>Rol</span>
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
            <option value="personel">Personel</option>
            <option value="yonetici">Yönetici</option>
          </select>
        </label>
        <button type="submit" className="savebtn self-end" disabled={busy || !username.trim() || !password}>
          Ekle
        </button>
      </div>
      <p className="yardim !mb-0">Kullanıcı adı: 3-32 karakter; küçük harf, rakam, nokta, tire, alt çizgi.</p>
      {hata && <div className="status err" role="alert">{hata}</div>}
    </form>
  );
}

function SifreSifirla({ username, onClose, onTamam }: { username: string; onClose: () => void; onTamam: () => void }) {
  const [sifre, setSifre] = useState("");
  const [hata, setHata] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setHata("");
    try {
      await postJson(`/api/admin/kullanicilar/${username}/sifre`, { password: sifre });
      onTamam();
    } catch (err) {
      setHata((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-arka" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="sifirla-baslik" onSubmit={kaydet}>
        <div className="modal-ust">
          <h2 id="sifirla-baslik">{username} için yeni şifre</h2>
          <button type="button" className="viewer-kapat" aria-label="Kapat" onClick={onClose}>
            ✕
          </button>
        </div>
        <label className="alan">
          <span>Yeni şifre (en az 10 karakter)</span>
          <input type="text" autoFocus autoComplete="off" spellCheck={false} value={sifre} onChange={(e) => setSifre(e.target.value)} />
        </label>
        <p className="yardim">Kullanıcının açık oturumları kapanır. Yeni şifreyi kendisine iletin; giriş yapınca "Şifremi değiştir" ile değiştirebilir.</p>
        <button className="printbtn" type="submit" disabled={busy || sifre.length < 10}>
          Şifreyi kaydet
        </button>
        {hata && <div className="status err" role="alert">{hata}</div>}
      </form>
    </div>
  );
}
