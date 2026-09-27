"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Istatistik } from "@/lib/types";

const sayi = (n: number) => n.toLocaleString("tr-TR");
const kisaGun = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
const uzunGun = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" });

/** Eksen için "yuvarlak" üst sınır: 1, 2, 5 × 10^n */
function tavan(n: number): number {
  if (n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 5, 10].find((m) => m * p >= n) ?? 10) * p;
}

export default function IstatistikSekmesi() {
  const [s, setS] = useState<Istatistik | null>(null);
  const [hata, setHata] = useState("");

  useEffect(() => {
    api<Istatistik>("/api/admin/istatistik")
      .then(setS)
      .catch((e) => setHata("İstatistikler okunamadı: " + (e as Error).message));
  }, []);

  if (hata) return <div className="status err">{hata}</div>;
  if (!s) return <div className="skel h-64 w-full" />;

  const o = s.ozet;
  return (
    <>
      <div className="kutucuklar">
        <Kutu etiket={`Son ${s.gun} günde bildirilen künye`} deger={o.sonKunye} alt={`${sayi(o.sonUrunCesidi)} farklı ürün`} />
        <Kutu etiket={`Son ${s.gun} günde yüklenen evrak`} deger={o.sonEvrak} />
        <Kutu etiket="Arşivdeki künye" deger={o.toplamKunye} alt={`${sayi(o.toplamEvrak)} evrak`} />
        <Kutu etiket="Aktif kullanıcı" deger={o.aktifKullanici} alt={`${sayi(o.toplamListe)} kayıtlı liste`} />
      </div>

      <div className="panel">
        <h2>📈 Günlük bildirilen künye · son {s.gun} gün</h2>
        <GunlukGrafik gunluk={s.gunluk} />
      </div>

      <div className="layout-grid">
        <div className="panel">
          <h2>🥬 En çok künyesi gelen ürünler · son {s.gun} gün</h2>
          {s.enCokUrun.length === 0 ? (
            <div className="empty">Bu dönemde künye yok.</div>
          ) : (
            <ol className="yatay-cubuklar">
              {s.enCokUrun.map((u) => (
                <li key={u.urun} title={`${u.urun}: ${u.adet} künye`}>
                  <span className="ad">{u.urun}</span>
                  <span className="cubuk-kap">
                    <span className="cubuk" style={{ width: `${(u.adet / s.enCokUrun[0]!.adet) * 100}%` }} />
                  </span>
                  <span className="deger">{sayi(u.adet)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="panel">
          <h2>👤 Kullanıcıya göre yükleme · son {s.gun} gün</h2>
          {s.kullaniciYukleme.length === 0 ? (
            <div className="empty">Bu dönemde yükleme yok.</div>
          ) : (
            <table className="tablo">
              <thead>
                <tr>
                  <th>Kullanıcı</th>
                  <th className="sayi">Evrak</th>
                  <th className="sayi">Künye</th>
                </tr>
              </thead>
              <tbody>
                {s.kullaniciYukleme.map((k) => (
                  <tr key={k.kullanici}>
                    <td>{k.kullanici}</td>
                    <td className="sayi">{sayi(k.evrak)}</td>
                    <td className="sayi">{sayi(k.kunye)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function Kutu({ etiket, deger, alt }: { etiket: string; deger: number; alt?: string }) {
  return (
    <div className="kutu">
      <span className="etiket">{etiket}</span>
      <span className="deger">{sayi(deger)}</span>
      {alt && <span className="alt">{alt}</span>}
    </div>
  );
}

function GunlukGrafik({ gunluk }: { gunluk: Istatistik["gunluk"] }) {
  const [secili, setSecili] = useState<number | null>(null);
  const ust = tavan(Math.max(...gunluk.map((g) => g.kunye)));
  const sec = secili == null ? null : gunluk[secili];
  const toplam = gunluk.reduce((a, g) => a + g.kunye, 0);

  return (
    <div>
      <div className="grafik" onMouseLeave={() => setSecili(null)}>
        <div className="eksen-y" aria-hidden="true">
          <span>{sayi(ust)}</span>
          <span>{sayi(ust / 2)}</span>
          <span>0</span>
        </div>
        <div className="cizim">
          <div className="izgara" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="sutunlar" role="img" aria-label={`Son ${gunluk.length} günde toplam ${toplam} künye bildirildi`}>
            {gunluk.map((g, i) => (
              <button
                key={g.gun}
                type="button"
                className={"sutun" + (secili === i ? " secili" : "") + (g.kunye === 0 ? " bos" : "")}
                aria-label={`${uzunGun(g.gun)}: ${g.kunye} künye, ${g.evrak} evrak`}
                onMouseEnter={() => setSecili(i)}
                onFocus={() => setSecili(i)}
                onBlur={() => setSecili(null)}
              >
                <span className="dolgu" style={{ height: `${(g.kunye / ust) * 100}%` }} />
              </button>
            ))}
          </div>
          {sec && secili != null && (
            <div
              className="ipucu"
              style={{ left: `${((secili + 0.5) / gunluk.length) * 100}%` }}
              role="status"
            >
              <b>{uzunGun(sec.gun)}</b>
              <span>{sayi(sec.kunye)} künye</span>
              <span>{sayi(sec.evrak)} evrak yüklendi</span>
            </div>
          )}
        </div>
      </div>
      <div className="eksen-x" aria-hidden="true">
        {gunluk.map((g, i) => (
          <span key={g.gun}>{i % 5 === 0 || i === gunluk.length - 1 ? kisaGun(g.gun) : ""}</span>
        ))}
      </div>
      <details className="tablo-gorunum">
        <summary>Tablo olarak göster</summary>
        <table className="tablo">
          <thead>
            <tr>
              <th>Gün</th>
              <th className="sayi">Bildirilen künye</th>
              <th className="sayi">Yüklenen evrak</th>
            </tr>
          </thead>
          <tbody>
            {[...gunluk].reverse().map((g) => (
              <tr key={g.gun}>
                <td>{uzunGun(g.gun)}</td>
                <td className="sayi">{sayi(g.kunye)}</td>
                <td className="sayi">{sayi(g.evrak)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
