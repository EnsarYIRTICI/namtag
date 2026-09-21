// pdf.js worker dosyasını public/ altına kopyalar (build/dev öncesi otomatik çalışır).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = dirname(require.resolve("pdfjs-dist/package.json"));
mkdirSync(join(root, "public"), { recursive: true });
copyFileSync(join(pkgDir, "build", "pdf.worker.min.mjs"), join(root, "public", "pdf.worker.min.mjs"));
console.log("pdf.worker.min.mjs -> public/");
