"use client";
import { linesToRecords, type ParsedKunye } from "./parser";

/** Dosyayı (CSV/HTML/PDF) satırlara böler. Sadece tarayıcıda çalışır. */

async function csvLines(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("windows-1254").decode(buf);
  } catch {
    text = new TextDecoder("utf-8").decode(buf);
  }
  return text
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function htmlLines(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(buf);
  } catch {
    text = new TextDecoder("windows-1254").decode(buf);
  }
  const doc = new DOMParser().parseFromString(text, "text/html");
  let nodes: Element[] = Array.from(doc.querySelectorAll("nobr"));
  if (nodes.length === 0) {
    nodes = Array.from(doc.querySelectorAll("td")).filter((td) => !td.querySelector("table,td"));
  }
  return nodes
    .map((n) => (n.textContent || "").replace(/\u00A0/g, " ").trim())
    .filter((l) => l.length > 0);
}

async function pdfLines(file: File): Promise<string[]> {
  let pdfjs: typeof import("pdfjs-dist");
  try {
    pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  } catch {
    throw new Error("PDF okuyucu kütüphanesi yüklenemedi. CSV ya da HTML formatını deneyin.");
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let buf = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      buf += item.str;
      if (item.hasEOL) {
        const t = buf.replace(/\u00A0/g, " ").trim();
        if (t) lines.push(t);
        buf = "";
      }
    }
    const t = buf.replace(/\u00A0/g, " ").trim();
    if (t) lines.push(t);
  }
  return lines;
}

export async function extractLinesFromFile(file: File): Promise<string[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return csvLines(file);
  if (name.endsWith(".html") || name.endsWith(".htm")) return htmlLines(file);
  if (name.endsWith(".pdf")) return pdfLines(file);
  throw new Error("Desteklenmeyen dosya türü: " + file.name);
}

export async function parseFile(file: File): Promise<ParsedKunye[]> {
  return linesToRecords(await extractLinesFromFile(file));
}
