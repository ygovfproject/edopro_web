// SQLite database for accounts, sessions and decks (Node's built-in node:sqlite,
// so the proxy keeps having no dependencies). One file on the server's disk; it is
// never reachable over the network, only through this service.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Deck limit per user. Also enforced by a trigger, so it holds even under concurrent writes. */
export const MAX_DECKS = 10;

// Schema versions, applied in order and recorded in PRAGMA user_version.
const MIGRATIONS = [
  // 1: users, sessions, decks
  `
  CREATE TABLE users (
    id             INTEGER PRIMARY KEY,
    username       TEXT    NOT NULL,
    username_key   TEXT    NOT NULL UNIQUE,  -- lower-case, for case-insensitive uniqueness
    password_hash  TEXT    NOT NULL,         -- scrypt$N$r$p$salt$hash
    created_at     INTEGER NOT NULL,         -- ms since epoch
    last_active_at INTEGER NOT NULL
  );
  CREATE INDEX users_last_active ON users(last_active_at);

  CREATE TABLE sessions (
    token_hash   TEXT    PRIMARY KEY,        -- SHA-256 of the token; the token itself is never stored
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_expires ON sessions(expires_at);

  CREATE TABLE decks (
    id         TEXT    PRIMARY KEY,          -- random UUID
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    content    TEXT    NOT NULL,             -- the .ydk exactly as uploaded
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX decks_user ON decks(user_id);

  CREATE TRIGGER decks_limit BEFORE INSERT ON decks
  WHEN (SELECT COUNT(*) FROM decks WHERE user_id = NEW.user_id) >= ${MAX_DECKS}
  BEGIN
    SELECT RAISE(ABORT, 'deck limit reached');
  END;
  `,
];

/** Opens (and creates or migrates) the database. Throws if node:sqlite is unavailable. */
export async function openDatabase(path) {
  let sqlite;
  try {
    sqlite = await import("node:sqlite");
  } catch {
    throw new Error("Accounts need Node.js 22.13 or newer (node:sqlite).");
  }
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new sqlite.DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.prepare("PRAGMA user_version").get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/**
 * Runs `fn` in a write transaction (BEGIN IMMEDIATE takes the write lock up front, so
 * checks and writes inside it can't interleave with another process, e.g. the cleanup job).
 */
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw e;
  }
}
