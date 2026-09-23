"use client";
import type { Kunye } from "@/lib/types";
import { COK_ESKI_GUN, ESKI_GUN, tarihKismi, yasSeviye } from "@/lib/tazelik";

/**
 * Künyenin güncelliğini gösteren küçük işaretler:
 *  ✓ En yeni    : bu ürünün arşivdeki en son bildirilmiş künyesi
 *  ⚠ N gün önce  : bildirimi ESKI_GUN / COK_ESKI_GUN günden eski
 *  Daha yeni var: aynı ürünün daha sonra bildirilmiş bir künyesi arşivde
 */
export default function TazelikIsaret({ k }: { k: Kunye }) {
  const seviye = yasSeviye(k.yasGun);
  const dahaYeni = !k.enYeni && k.dahaYeni != null;
  if (!k.enYeni && !seviye && !dahaYeni) return null;
  return (
    <span className="tz-satir">
      {k.enYeni && (
        <span className="tz tz-yeni" title="Bu ürünün arşivdeki en son bildirilmiş künyesi">
          ✓ En yeni
        </span>
      )}
      {seviye && (
        <span
          className={"tz " + (seviye === "cok-eski" ? "tz-cok-eski" : "tz-eski")}
          title={
            seviye === "cok-eski"
              ? `Bildirimi ${COK_ESKI_GUN} günden eski. Tezgahtaki ürün bu partiden mi, kontrol edin.`
              : `Bildirimi ${ESKI_GUN} günden eski.`
          }
        >
          ⚠ {k.yasGun} gün önce bildirilmiş
        </span>
      )}
      {dahaYeni && (
        <span className="tz tz-not" title="Aynı ürünün daha sonra bildirilmiş bir künyesi arşivde var">
          Daha yeni künye var{k.dahaYeni ? ": " + tarihKismi(k.dahaYeni) : ""}
        </span>
      )}
    </span>
  );
}
