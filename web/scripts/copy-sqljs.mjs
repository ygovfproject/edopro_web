// Copies sql.js (SQLite in WebAssembly) into public/sqljs so the browser can
// load it as a plain script. Runs automatically after `npm install`.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "sql.js", "dist");
const dst = join(root, "public", "sqljs");
if (!existsSync(src)) {
  console.warn("[copy-sqljs] node_modules/sql.js not found, skipping");
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
for (const f of ["sql-wasm.js", "sql-wasm.wasm"]) copyFileSync(join(src, f), join(dst, f));
console.log("[copy-sqljs] copied sql.js to public/sqljs");
