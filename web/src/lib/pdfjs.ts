"use client";

/**
 * pdf.js'i yükler. "legacy" derleme kullanılır: normal derleme çok yeni JS özelliklerine
 * (örn. Map.prototype.getOrInsertComputed) ihtiyaç duyuyor ve biraz eski tarayıcılarda,
 * özellikle telefonlarda, PDF okuma/gösterme hata veriyor. Legacy derleme bunlar için yama içerir.
 * Worker dosyası build öncesi public/ altına kopyalanır (scripts/copy-pdf-worker.mjs).
 */
export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}
