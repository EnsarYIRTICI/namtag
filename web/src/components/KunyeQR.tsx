"use client";
import { useMemo } from "react";
import QRCode from "qrcode";

/**
 * Hal Kayıt Sistemi künyelerindeki QR ile aynı yapıda QR üretir:
 * versiyon 5 (37x37), hata düzeltme L, maske 4.
 */
export default function KunyeQR({ value, size = 56 }: { value: string; size?: number }) {
  const { n, d } = useMemo(() => {
    const qr = QRCode.create(value || " ", {
      version: 5,
      errorCorrectionLevel: "L",
      maskPattern: 4,
    });
    const n = qr.modules.size;
    const data = qr.modules.data;
    let d = "";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (data[y * n + x]) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { n, d };
  }, [value]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
