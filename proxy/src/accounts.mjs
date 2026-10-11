// Accounts and cloud decks: registration, login, sessions and up to MAX_DECKS .ydk
// decks per user, stored in SQLite (see db.mjs).
//
// Sessions are bearer tokens (the web client lives on another site than this API, and
// browsers block cross-site cookies). Only a SHA-256 hash of each token is stored.
// Passwords are hashed with scrypt. Every query is a prepared statement.

import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { MAX_DECKS, transaction } from "./db.mjs";
import { ipKey, LIMITS, RateLimiter } from "./ratelimit.mjs";

const scrypt = promisify(scryptCb);

export const SESSION_DAYS = 30;
export const MAX_SESSIONS_PER_USER = 20;
export const INACTIVE_DAYS = 90;
export const MAX_DECK_BYTES = 100 * 1024;
const MAX_AUTH_BODY = 4 * 1024;
const MAX_DECK_BODY = MAX_DECK_BYTES * 2 + 4 * 1024; // JSON escaping can double the size
const DAY = 24 * 60 * 60 * 1000;
/** Activity / session refresh is written at most this often per user / session. */
const TOUCH_EVERY = 60 * 60 * 1000;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };
// The username is also the duelist name, and EDOPro names are at most 19 characters.
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,19}$/;
const DECK_LINE_RE = /^(?:\s*|[#!].*|\d{1,10}\s*)$/;

/**
 * At most this many password hashes are computed at once (each takes ~100 ms of CPU and
 * 32 MiB). Beyond that the request gets 503, so a flood of logins can't starve the
 * WebSocket bridge.
 */
export const MAX_SCRYPT_JOBS = 4;
let scryptJobs = 0;

async function limitedScrypt(...args) {
  if (scryptJobs >= MAX_SCRYPT_JOBS) throw new HttpError(503, "The server is busy. Please try again in a moment.", { "Retry-After": "2" });
  scryptJobs++;
  try {
    return await scrypt(...args);
  } finally {
    scryptJobs--;
  }
}

async function hashPassword(password, { limited = true } = {}) {
  const salt = randomBytes(16);
  const key = await (limited ? limitedScrypt : scrypt)(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(password, stored) {
  const [kind, N, r, p, saltB64, keyB64] = stored.split("$");
  if (kind !== "scrypt") return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await limitedScrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Used for logins to unknown usernames, so they take as long as real ones.
let dummyHash = null;

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

/** Reads a JSON body of at most `max` bytes. */
function readJson(req, max) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers["content-type"] ?? "");
    if (!type.toLowerCase().startsWith("application/json")) return reject(new HttpError(415, "Expected application/json"));
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > max) return reject(new HttpError(413, "Request too large", { Connection: "close" }));
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c) => {
      if (tooLarge) return; // keep reading (and discarding) so the 413 can be delivered
      size += c.length;
      if (size > max) {
        tooLarge = true;
        chunks.length = 0;
        // Answer now; "Connection: close" ends the connection once the reply is sent.
        reject(new HttpError(413, "Request too large", { Connection: "close" }));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) return;
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch {
        reject(new HttpError(400, "Invalid JSON"));
      }
    });
    req.on("error", () => reject(new HttpError(400, "Request failed")));
  });
}

function validUsername(u) {
  if (typeof u !== "string" || !USERNAME_RE.test(u)) {
    throw new HttpError(400, "Username must be 3-19 characters: letters, digits, '_', '.' or '-'.");
  }
  return u;
}

function validPassword(p) {
  if (typeof p !== "string" || p.length < 8 || p.length > 128) throw new HttpError(400, "Password must be 8-128 characters.");
  return p;
}

function validDeckName(n) {
  if (typeof n !== "string") throw new HttpError(400, "Deck name is required.");
  const name = n.trim();
  // No control characters (U+0000-U+001F, U+007F).
  if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) throw new HttpError(400, "Deck name must be 1-64 characters.");
  return name;
}

function validYdk(y) {
  if (typeof y !== "string" || !y.length) throw new HttpError(400, "Deck contents (.ydk) are required.");
  if (Buffer.byteLength(y, "utf8") > MAX_DECK_BYTES) throw new HttpError(413, "Deck is larger than 100 KiB.");
  // A .ydk is lines of card passcodes, section markers (#main, #extra, !side) and comments.
  if (!y.split(/\r?\n/).every((line) => DECK_LINE_RE.test(line))) throw new HttpError(400, "That is not a .ydk deck.");
  return y;
}

const publicUser = (u) => ({ username: u.username, createdAt: new Date(u.created_at).toISOString() });
const publicDeck = (d) => ({
  id: d.id,
  name: d.name,
  ydk: d.content,
  createdAt: new Date(d.created_at).toISOString(),
  updatedAt: new Date(d.updated_at).toISOString(),
});

/**
 * Creates the accounts API. `handle(req, res, url, ctx)` returns true if it answered the
 * request (paths under /api/auth and /api/decks). `ctx` gives the client IP and how to
 * send JSON (CORS headers included).
 */
export function createAccounts(db, { now = Date.now, limits = LIMITS } = {}) {
  const limiter = Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, new RateLimiter(v.limit, v.windowMs, now)]));
  const sweeper = setInterval(() => Object.values(limiter).forEach((l) => l.sweep()), 60_000);
  sweeper.unref?.();

  const q = {
    userByKey: db.prepare("SELECT * FROM users WHERE username_key = ?"),
    insertUser: db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at, last_active_at) VALUES (?, ?, ?, ?, ?)",
    ),
    touchUser: db.prepare("UPDATE users SET last_active_at = ? WHERE id = ?"),
    deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
    session: db.prepare(
      `SELECT s.token_hash, s.last_used_at, s.expires_at, u.id AS user_id, u.username, u.created_at, u.last_active_at, u.password_hash
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    ),
    insertSession: db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?)"),
    touchSession: db.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    trimSessions: db.prepare(
      `DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN
         (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY last_used_at DESC LIMIT ?)`,
    ),
    decks: db.prepare("SELECT * FROM decks WHERE user_id = ? ORDER BY created_at, id"),
    deck: db.prepare("SELECT * FROM decks WHERE id = ? AND user_id = ?"),
    countDecks: db.prepare("SELECT COUNT(*) AS n FROM decks WHERE user_id = ?"),
    insertDeck: db.prepare("INSERT INTO decks (id, user_id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"),
    updateDeck: db.prepare("UPDATE decks SET name = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ?"),
    deleteDeck: db.prepare("DELETE FROM decks WHERE id = ? AND user_id = ?"),
  };

  function limit(name, key) {
    const r = limiter[name].hit(key);
    if (!r.ok) throw new HttpError(429, "Too many requests. Please wait a moment.", { "Retry-After": String(r.retryAfter) });
  }

  /** The signed-in user for this request, or null. Refreshes the session and activity. */
  function authenticate(req) {
    const h = req.headers.authorization;
    if (typeof h !== "string" || !h.startsWith("Bearer ")) return null;
    const token = h.slice(7).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = sha256(token);
    const s = q.session.get(hash);
    const t = now();
    if (!s) return null;
    if (s.expires_at <= t) {
      q.deleteSession.run(hash);
      return null;
    }
    if (t - s.last_used_at > TOUCH_EVERY) q.touchSession.run(t, t + SESSION_DAYS * DAY, hash);
    if (t - s.last_active_at > TOUCH_EVERY) q.touchUser.run(t, s.user_id);
    return { id: s.user_id, username: s.username, created_at: s.created_at, password_hash: s.password_hash, tokenHash: hash };
  }

  function newSession(userId) {
    const token = randomBytes(32).toString("base64url");
    const t = now();
    transaction(db, () => {
      q.insertSession.run(sha256(token), userId, t, t, t + SESSION_DAYS * DAY);
      // At most MAX_SESSIONS_PER_USER sessions: the least recently used go first.
      q.trimSessions.run(userId, userId, MAX_SESSIONS_PER_USER);
    });
    return token;
  }

  function requireUser(user) {
    if (!user) throw new HttpError(401, "Please sign in.");
    return user;
  }

  async function register(req, ip) {
    limit("register", ip);
    const body = await readJson(req, MAX_AUTH_BODY);
    const username = validUsername(body.username);
    const password = validPassword(body.password);
    const hash = await hashPassword(password);
    const t = now();
    let id;
    try {
      id = Number(q.insertUser.run(username, username.toLowerCase(), hash, t, t).lastInsertRowid);
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "That username is taken.");
      throw e;
    }
    return [201, { token: newSession(id), user: publicUser({ username, created_at: t }) }];
  }

  async function login(req, ip) {
    limit("login", ip);
    const body = await readJson(req, MAX_AUTH_BODY);
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password.slice(0, 128) : "";
    const key = USERNAME_RE.test(username) ? username.toLowerCase() : null;
    // Failed logins are also counted per username, so guessing one account's password
    // from many addresses is limited too.
    const r = key ? limiter.loginUser.check(key) : { ok: true };
    if (!r.ok) throw new HttpError(429, "Too many failed sign-ins for this account. Please wait a moment.", { "Retry-After": String(r.retryAfter) });
    const user = key ? q.userByKey.get(key) : undefined;
    // Same work whether or not the user exists, so usernames can't be probed by timing.
    dummyHash ??= await hashPassword("not-a-real-password", { limited: false });
    const ok = await verifyPassword(password, user?.password_hash ?? dummyHash);
    if (!user || !ok) {
      if (key) limiter.loginUser.hit(key);
      throw new HttpError(401, "Wrong username or password.");
    }
    q.touchUser.run(now(), user.id);
    return [200, { token: newSession(user.id), user: publicUser(user) }];
  }

  function listDecks(user) {
    limit("list", user.id);
    return [200, { decks: q.decks.all(user.id).map(publicDeck), limit: MAX_DECKS }];
  }

  async function createDeck(req, user) {
    limit("write", user.id);
    const body = await readJson(req, MAX_DECK_BODY);
    const name = validDeckName(body.name);
    const ydk = validYdk(body.ydk);
    const t = now();
    const id = randomUUID();
    try {
      transaction(db, () => {
        if (q.countDecks.get(user.id).n >= MAX_DECKS) throw new HttpError(409, `You can store up to ${MAX_DECKS} decks.`);
        q.insertDeck.run(id, user.id, name, ydk, t, t);
      });
    } catch (e) {
      // The database trigger is the last line of defence for the limit.
      if (String(e.message).includes("deck limit reached")) throw new HttpError(409, `You can store up to ${MAX_DECKS} decks.`);
      throw e;
    }
    return [201, { deck: publicDeck(q.deck.get(id, user.id)) }];
  }

  async function updateDeck(req, user, id) {
    limit("write", user.id);
    const body = await readJson(req, MAX_DECK_BODY);
    const name = validDeckName(body.name);
    const ydk = validYdk(body.ydk);
    // Someone else's deck looks exactly like a missing one.
    const changed = q.updateDeck.run(name, ydk, now(), id, user.id).changes;
    if (!changed) throw new HttpError(404, "Deck not found.");
    return [200, { deck: publicDeck(q.deck.get(id, user.id)) }];
  }

  function deleteDeck(user, id) {
    limit("write", user.id);
    if (!q.deleteDeck.run(id, user.id).changes) throw new HttpError(404, "Deck not found.");
    return [204, null];
  }

  async function deleteAccount(req, user) {
    // Each attempt checks the password: limit it like logins.
    limit("password", user.id);
    const body = await readJson(req, MAX_AUTH_BODY);
    if (!(await verifyPassword(typeof body.password === "string" ? body.password.slice(0, 128) : "", user.password_hash))) {
      throw new HttpError(401, "Wrong password.");
    }
    q.deleteUser.run(user.id); // sessions and decks go with it (ON DELETE CASCADE)
    return [204, null];
  }

  async function route(req, url, ip) {
    const path = url.pathname;
    const m = req.method;
    const user = authenticate(req);
    // General limits: per signed-in user, otherwise per IP.
    if (user) limit("user", user.id);
    else limit("ip", ip);

    if (path === "/api/auth/register" && m === "POST") return register(req, ip);
    if (path === "/api/auth/login" && m === "POST") return login(req, ip);
    if (path === "/api/auth/logout" && m === "POST") {
      if (user) q.deleteSession.run(user.tokenHash);
      return [204, null];
    }
    if (path === "/api/auth/me" && m === "GET") return [200, { user: publicUser(requireUser(user)) }];
    if (path === "/api/auth/account" && m === "DELETE") return deleteAccount(req, requireUser(user));
    if (path === "/api/decks") {
      if (m === "GET") return listDecks(requireUser(user));
      if (m === "POST") return createDeck(req, requireUser(user));
    }
    const d = path.match(/^\/api\/decks\/([0-9a-f-]{36})$/);
    if (d) {
      if (m === "PUT") return updateDeck(req, requireUser(user), d[1]);
      if (m === "DELETE") return deleteDeck(requireUser(user), d[1]);
    }
    throw new HttpError(path.startsWith("/api/decks") || path.startsWith("/api/auth") ? 405 : 404, "Not found");
  }

  return {
    /** True for paths this API answers. */
    owns(pathname) {
      return pathname.startsWith("/api/auth/") || pathname === "/api/decks" || pathname.startsWith("/api/decks/");
    },
    async handle(req, res, url, { ip, send }) {
      try {
        const [status, body] = await route(req, url, ipKey(ip));
        send(status, body);
      } catch (e) {
        if (e instanceof HttpError) return send(e.status, { error: e.message }, e.headers);
        // Unexpected: log the kind of failure only (never request bodies, tokens or passwords).
        console.error(new Date().toISOString(), "accounts API error:", e?.code ?? e?.name ?? "error", e?.message);
        send(500, { error: "Something went wrong." });
      }
    },
    close() {
      clearInterval(sweeper);
    },
  };
}

/**
 * Deletes accounts inactive for INACTIVE_DAYS (with their sessions and decks) and
 * expired sessions. Returns what was deleted. Run daily (see maintenance.mjs).
 */
export function cleanup(db, now = Date.now()) {
  return transaction(db, () => {
    const users = db.prepare("DELETE FROM users WHERE last_active_at < ?").run(now - INACTIVE_DAYS * DAY).changes;
    const sessions = db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now).changes;
    return { users, sessions };
  });
}
