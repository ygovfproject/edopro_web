// Daily maintenance for the accounts database, run by a systemd timer on the server
// (see infra/oracle) or by hand:
//   node src/maintenance.mjs config.json
//
//  1. Deletes accounts inactive for 90 days, with their sessions and decks, and
//     expired sessions.
//  2. Writes a consistent backup copy of the database (VACUUM INTO) next to it in
//     backups/, keeping the newest BACKUPS_KEPT.

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup } from "./accounts.mjs";
import { openDatabase } from "./db.mjs";
import { loadConfig } from "./server.mjs";

export const BACKUPS_KEPT = 7;

/** Copies the database to `dir/accounts-YYYYMMDD-HHMMSS.db` and prunes old copies. */
export function backup(db, dir, now = new Date()) {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const file = join(dir, `accounts-${stamp}.db`);
  rmSync(file, { force: true });
  // VACUUM INTO writes a complete, consistent copy even while the service is running.
  db.prepare("VACUUM INTO ?").run(file);
  const old = readdirSync(dir)
    .filter((f) => /^accounts-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(BACKUPS_KEPT);
  for (const f of old) rmSync(join(dir, f), { force: true });
  return file;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const cfg = loadConfig(process.argv[2]);
  if (!cfg.accounts?.dbPath) {
    console.log("Accounts are not enabled in the config; nothing to do.");
    process.exit(0);
  }
  const dbPath = resolve(cfg.accounts.dbPath);
  const db = await openDatabase(dbPath);
  const removed = cleanup(db);
  const file = backup(db, cfg.accounts.backupDir ? resolve(cfg.accounts.backupDir) : join(dirname(dbPath), "backups"));
  db.close();
  console.log(`${new Date().toISOString()} removed ${removed.users} inactive account(s), ${removed.sessions} expired session(s); backup ${file}`);
}
