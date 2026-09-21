"use client";
import { Fragment } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Kunye } from "@/lib/types";

// "ANTALYA/KUMLUCA" gibi değerlerde '/' sonrasında satır kırılabilsin
function WbrText({ text }: { text: string }) {
  const parts = (text || "-").split("/");
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <>
              /<wbr />
            </>
          )}
          {p}
        </Fragment>
      ))}
    </>
  );
}

function Row({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className={"row" + (cls ? " " + cls : "")}>
      <span>{label} :</span>
      <span>
        <WbrText text={value} />
      </span>
    </div>
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** A4 sayfası 2x2 = 4 kart; her sayfa ayrı bir .print-page (sayfa sonu garantili). Sadece yazdırırken görünür. */
export default function PrintArea({ selected }: { selected: Kunye[] }) {
  return (
    <div id="print-area">
      {chunk(selected, 4).map((page, pi) => (
        <div className="print-page" key={pi}>
          {page.map((r) => (
            <div className="label-box" key={r.kunyeNo}>
              <div className="urun">{r.urun}</div>
              <div className="tip">{r.tip || ""}</div>
              <div className="qr">
                <div>
                  <QRCodeSVG value={r.kunyeNo} size={56} level="M" />
                </div>
              </div>
              <div className="kno">{r.kunyeNo}</div>
              <div className="rows">
                <Row label="Bildirim Tarihi" value={r.bildirimTarihi} />
                <Row label="Üretim Yeri" value={r.uretimYeri} />
                <Row label="Üretim Tarihi" value={r.uretimTarihi} />
                <Row label="Üreticisinin Adı" value={r.ureticiAdi} cls="before-qty" />
                <Row label="Miktar" value={r.miktar} />
                <Row label="Alış Fiyatı" value={r.fiyat} cls="before-foot" />
              </div>
              <div className="foot">
                Gümrük ve Ticaret Bakanlığı Hal Kayıt Sisteminden
                <br />
                alınan künye bilgilerini www.hal.gov.tr adresinden
                <br />
                künye numarası ile sorgulayabilirsiniz.
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
