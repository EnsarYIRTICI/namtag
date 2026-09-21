"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { parseFile } from "@/lib/extract";
import type { UploadResult } from "@/lib/types";
import type { Status } from "./Dashboard";

interface Props {
  status: Status;
  setStatus: (s: Status) => void;
  onChanged: () => Promise<void>;
}

const ACCEPT_RE = /\.(csv|html?|pdf)$/i;

export default function UploadPanel({ status, setStatus, onChanged }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);

  // Her evrak ayrı ayrı işlenir: künyeleri zaten arşivdeyse evrak "daha önce yüklenmiş" sayılıp
  // reddedilir (dosya adı değişse bile). Kabul edilen evrakın orijinal dosyası da arşivlenir.
  async function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => ACCEPT_RE.test(f.name));
    if (files.length === 0) {
      setStatus({ msg: "Lütfen .csv, .html veya .pdf dosyası seçin.", cls: "err" });
      return;
    }
    setBusy(true);
    const lines: string[] = [];
    let anyProblem = false;
    let anyAdded = false;
    for (const file of files) {
      setStatus({ msg: file.name + " işleniyor...", cls: "" });
      try {
        const records = await parseFile(file);
        if (records.length === 0) {
          lines.push("✖ " + file.name + ": künye kaydı bulunamadı.");
          anyProblem = true;
          continue;
        }
        const fd = new FormData();
        fd.append("ad", file.name);
        fd.append("records", JSON.stringify(records));
        fd.append("file", file);
        const data = await api<UploadResult>("/api/evraklar", { method: "POST", body: fd });
        if (data.added === 0 && data.skipped > 0) {
          lines.push(`✖ ${file.name}: bu evrak daha önce yüklenmiş, tekrar yüklenemez (${data.skipped} künye zaten kayıtlı).`);
          anyProblem = true;
        } else {
          anyAdded = true;
          let m = `✔ ${file.name}: ${data.added} yeni künye eklendi`;
          if (data.skipped > 0) m += `, ${data.skipped} künye zaten kayıtlıydı (atlandı)`;
          lines.push(m + ".");
        }
        if (data.invalid) lines.push(`   ${data.invalid} geçersiz kayıt alınmadı.`);
      } catch (e) {
        lines.push("✖ " + file.name + ": " + (e as Error).message);
        anyProblem = true;
      }
    }
    setStatus({ msg: lines.join("\n"), cls: anyProblem ? "err" : "ok" });
    if (anyAdded) await onChanged();
    if (inputRef.current) inputRef.current.value = "";
    setBusy(false);
  }

  return (
    <div className="panel">
      <h2>📥 Künye Yükle</h2>
      <div
        className={"drop" + (drag ? " drag" : "")}
        onClick={() => !busy && inputRef.current?.click()}
        onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDrag(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy) void handleFiles(e.dataTransfer.files);
        }}
      >
        <div>
          <b>Dosya seçmek için tıklayın</b> ya da dosyaları buraya sürükleyin
        </div>
        <div className="mt-1">Birden fazla dosya, birden fazla format karışık seçilebilir</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        accept=".csv,.html,.htm,.pdf"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <div className="fmts">
        <span className="fmt-chip">.csv</span>
        <span className="fmt-chip">.html / .htm</span>
        <span className="fmt-chip">.pdf</span>
      </div>
      <div className={"status" + (status.cls ? " " + status.cls : "")}>{status.msg}</div>
    </div>
  );
}
