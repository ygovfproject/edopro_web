// Accounts and cloud decks: authentication, deck operations, authorization, rate limits,
// concurrent writes and inactive-account cleanup. Uses a throwaway SQLite file and a
// controllable clock.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProxy } from "../src/server.mjs";
import http from "node:http";
import { createAccounts, cleanup, INACTIVE_DAYS, MAX_DECK_BYTES, MAX_SCRYPT_JOBS } from "../src/accounts.mjs";
import { openDatabase, MAX_DECKS } from "../src/db.mjs";
import { backup, BACKUPS_KEPT } from "../src/maintenance.mjs";
import { ipKey, LIMITS } from "../src/ratelimit.mjs";

const DAY = 24 * 60 * 60 * 1000;
let dir, db, accounts, proxy, base;
let clock = Date.parse("2026-01-01T00:00:00Z");
const now = () => clock;

// Generous limits for the functional tests; rate limiting has its own server below.
const LOOSE = Object.fromEntries(Object.keys(LIMITS).map((k) => [k, { limit: 10_000, windowMs: 60_000 }]));

async function startServer(limits) {
  const acc = createAccounts(db, { now, limits });
  const srv = createProxy({ host: "127.0.0.1", port: 0, allowedOrigins: ["https://site.example"], trustProxy: true, servers: [], maxConnectionsPerIp: 8, maxConnections: 10 }, acc);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { acc, srv, base: `http://127.0.0.1:${srv.address().port}` };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "edopro-accounts-"));
  db = await openDatabase(join(dir, "accounts.db"));
  ({ acc: accounts, srv: proxy, base } = await startServer(LOOSE));
});

after(() => {
  accounts.close();
  proxy.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec("DELETE FROM users");
});

async function call(method, path, { token, body, ip = "203.0.113.1", raw, server = base, headers = {} } = {}) {
  const res = await fetch(server + path, {
    method,
    headers: {
      ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-Forwarded-For": ip,
      Origin: "https://site.example",
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

const YDK = "#created by EDOPro Web\r\n#main\r\n89631139\r\n89631139\r\n#extra\r\n!side\r\n";

async function signUp(username = "alice", password = "correct horse") {
  const r = await call("POST", "/api/auth/register", { body: { username, password } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.token;
}

/* ---------------- authentication ---------------- */

test("register, me, logout, login", async () => {
  const token = await signUp("Alice");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const me = await call("GET", "/api/auth/me", { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, "Alice");
  assert.equal(me.headers.get("access-control-allow-origin"), "https://site.example");

  assert.equal((await call("POST", "/api/auth/logout", { token })).status, 204);
  assert.equal((await call("GET", "/api/auth/me", { token })).status, 401);

  const bad = await call("POST", "/api/auth/login", { body: { username: "alice", password: "wrong password" } });
  assert.equal(bad.status, 401);
  const unknown = await call("POST", "/api/auth/login", { body: { username: "nobody", password: "whatever1" } });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, bad.body.error, "unknown user and wrong password look the same");

  // Usernames are case-insensitive for login.
  const ok = await call("POST", "/api/auth/login", { body: { username: "ALICE", password: "correct horse" } });
  assert.equal(ok.status, 200);
  assert.equal((await call("GET", "/api/auth/me", { token: ok.body.token })).status, 200);
});

test("usernames are unique (case-insensitively) and inputs are validated", async () => {
  await signUp("alice");
  assert.equal((await call("POST", "/api/auth/register", { body: { username: "ALICE", password: "another pass" } })).status, 409);
  await signUp("a".repeat(19));
  for (const body of [
    { username: "ab", password: "long enough" },
    { username: "a".repeat(20), password: "long enough" }, // longer than an EDOPro duelist name
    { username: "bad name", password: "long enough" },
    { username: "x'; DROP TABLE users;--", password: "long enough" },
    { username: "bob", password: "short" },
    { username: "bob", password: "x".repeat(129) },
    { username: 5, password: "long enough" },
  ]) {
    assert.equal((await call("POST", "/api/auth/register", { body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await call("POST", "/api/auth/register", { raw: "{not json" })).status, 400);
  assert.equal((await call("POST", "/api/auth/register", { raw: JSON.stringify({ username: "bob", password: "x".repeat(5000) }) })).status, 413);
  const wrongType = await call("POST", "/api/auth/register", { raw: "username=bob", headers: { "Content-Type": "text/plain" } });
  assert.equal(wrongType.status, 415);
});

test("passwords and tokens are not stored in plain text", async () => {
  const token = await signUp("alice", "my secret pw");
  const user = db.prepare("SELECT password_hash FROM users").get();
  assert.match(user.password_hash, /^scrypt\$/);
  assert.ok(!user.password_hash.includes("my secret pw"));
  const session = db.prepare("SELECT token_hash FROM sessions").get();
  assert.notEqual(session.token_hash, token);
});

test("sessions expire after 30 days without use and are refreshed by use", async () => {
  const token = await signUp();
  clock += 20 * DAY;
  assert.equal((await call("GET", "/api/auth/me", { token })).status, 200); // refreshes to +30 days
  clock += 25 * DAY;
  assert.equal((await call("GET", "/api/auth/me", { token })).status, 200);
  clock += 31 * DAY;
  assert.equal((await call("GET", "/api/auth/me", { token })).status, 401);
});

test("a user keeps at most 20 sessions", async () => {
  await signUp();
  for (let i = 0; i < 25; i++) {
    clock += 1000;
    assert.equal((await call("POST", "/api/auth/login", { body: { username: "alice", password: "correct horse" } })).status, 200);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 20);
});

test("deleting the account needs the password and removes everything", async () => {
  const token = await signUp();
  await call("POST", "/api/decks", { token, body: { name: "A", ydk: YDK } });
  assert.equal((await call("DELETE", "/api/auth/account", { token, body: { password: "nope nope" } })).status, 401);
  assert.equal((await call("DELETE", "/api/auth/account", { token, body: { password: "correct horse" } })).status, 204);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decks").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
  assert.equal((await call("GET", "/api/auth/me", { token })).status, 401);
});

/* ---------------- decks ---------------- */

test("create, list, update and delete decks; .ydk kept byte for byte", async () => {
  const token = await signUp();
  const c = await call("POST", "/api/decks", { token, body: { name: "  Blue-Eyes  ", ydk: YDK } });
  assert.equal(c.status, 201);
  const d = c.body.deck;
  assert.match(d.id, /^[0-9a-f-]{36}$/);
  assert.equal(d.name, "Blue-Eyes");
  assert.equal(d.ydk, YDK);
  assert.ok(d.createdAt && d.updatedAt);

  clock += 5000;
  const u = await call("PUT", `/api/decks/${d.id}`, { token, body: { name: "Blue-Eyes v2", ydk: YDK + "#comment\n" } });
  assert.equal(u.status, 200);
  assert.equal(u.body.deck.ydk, YDK + "#comment\n");
  assert.equal(u.body.deck.createdAt, d.createdAt);
  assert.notEqual(u.body.deck.updatedAt, d.updatedAt);

  const l = await call("GET", "/api/decks", { token });
  assert.equal(l.status, 200);
  assert.equal(l.body.limit, MAX_DECKS);
  assert.deepEqual(l.body.decks.map((x) => x.name), ["Blue-Eyes v2"]);

  assert.equal((await call("DELETE", `/api/decks/${d.id}`, { token })).status, 204);
  assert.equal((await call("GET", "/api/decks", { token })).body.decks.length, 0);
  assert.equal((await call("DELETE", `/api/decks/${d.id}`, { token })).status, 404);
});

test("deck input is validated and limited to 100 KiB", async () => {
  const token = await signUp();
  for (const body of [{ name: "", ydk: YDK }, { name: "x".repeat(65), ydk: YDK }, { name: "A", ydk: "" }, { name: "A", ydk: "<script>alert(1)</script>" }, { name: "A\u0000", ydk: YDK }]) {
    assert.equal((await call("POST", "/api/decks", { token, body })).status, 400, JSON.stringify(body).slice(0, 60));
  }
  const big = "#main\n" + "89631139\n".repeat(Math.ceil(MAX_DECK_BYTES / 9));
  assert.equal((await call("POST", "/api/decks", { token, body: { name: "Big", ydk: big } })).status, 413);
  const justFits = "#main\n" + "1\n".repeat((MAX_DECK_BYTES - 6) / 2);
  assert.equal(Buffer.byteLength(justFits), MAX_DECK_BYTES);
  assert.equal((await call("POST", "/api/decks", { token, body: { name: "Fits", ydk: justFits } })).status, 201);
});

test("each user can store at most 10 decks", async () => {
  const token = await signUp();
  for (let i = 0; i < MAX_DECKS; i++) assert.equal((await call("POST", "/api/decks", { token, body: { name: `D${i}`, ydk: YDK } })).status, 201);
  const r = await call("POST", "/api/decks", { token, body: { name: "one too many", ydk: YDK } });
  assert.equal(r.status, 409);
});

test("concurrent creates never go over the limit", async () => {
  const token = await signUp();
  const results = await Promise.all(
    Array.from({ length: 15 }, (_, i) => call("POST", "/api/decks", { token, body: { name: `P${i}`, ydk: YDK } })),
  );
  assert.equal(results.filter((r) => r.status === 201).length, MAX_DECKS);
  assert.equal(results.filter((r) => r.status === 409).length, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decks").get().n, MAX_DECKS);
});

test("the database itself refuses an 11th deck", async () => {
  await signUp();
  const userId = db.prepare("SELECT id FROM users").get().id;
  const ins = db.prepare("INSERT INTO decks (id, user_id, name, content, created_at, updated_at) VALUES (?, ?, 'x', 'x', 0, 0)");
  for (let i = 0; i < MAX_DECKS; i++) ins.run(`00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, userId);
  assert.throws(() => ins.run("00000000-0000-0000-0000-999999999999", userId), /deck limit reached/);
});

/* ---------------- authorization ---------------- */

test("users can't see or change each other's decks", async () => {
  const alice = await signUp("alice");
  const bob = await signUp("bob", "bobs password");
  const d = (await call("POST", "/api/decks", { token: alice, body: { name: "Mine", ydk: YDK } })).body.deck;
  assert.equal((await call("GET", "/api/decks", { token: bob })).body.decks.length, 0);
  assert.equal((await call("PUT", `/api/decks/${d.id}`, { token: bob, body: { name: "Stolen", ydk: YDK } })).status, 404);
  assert.equal((await call("DELETE", `/api/decks/${d.id}`, { token: bob })).status, 404);
  const still = (await call("GET", "/api/decks", { token: alice })).body.decks;
  assert.deepEqual(still.map((x) => x.name), ["Mine"]);
});

test("deck endpoints need a valid session", async () => {
  assert.equal((await call("GET", "/api/decks")).status, 401);
  assert.equal((await call("GET", "/api/decks", { token: "A".repeat(43) })).status, 401);
  assert.equal((await call("GET", "/api/decks", { token: "not-a-token" })).status, 401);
  assert.equal((await call("POST", "/api/decks", { body: { name: "x", ydk: YDK } })).status, 401);
});

test("CORS preflight allows the API's methods and headers", async () => {
  const r = await fetch(base + "/api/decks", { method: "OPTIONS", headers: { Origin: "https://site.example" } });
  assert.equal(r.status, 204);
  assert.match(r.headers.get("access-control-allow-methods"), /PUT/);
  assert.match(r.headers.get("access-control-allow-headers"), /Authorization/);
});

/* ---------------- rate limiting ---------------- */

test("rate limits return 429", async (t) => {
  const { acc, srv, base: rl } = await startServer(LIMITS);
  t.after(() => {
    acc.close();
    srv.close();
  });
  const opt = (o) => ({ server: rl, ...o });

  // Login: 5 attempts per 15 minutes per IP.
  for (let i = 0; i < 5; i++) {
    assert.equal((await call("POST", "/api/auth/login", opt({ ip: "198.51.100.1", body: { username: "nobody", password: "whatever1" } }))).status, 401);
  }
  const blocked = await call("POST", "/api/auth/login", opt({ ip: "198.51.100.1", body: { username: "nobody", password: "whatever1" } }));
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  // Other IPs aren't affected; the block lifts after 15 minutes.
  assert.equal((await call("POST", "/api/auth/login", opt({ ip: "198.51.100.2", body: { username: "nobody", password: "whatever1" } }))).status, 401);
  clock += 15 * 60_000 + 1;
  assert.equal((await call("POST", "/api/auth/login", opt({ ip: "198.51.100.1", body: { username: "nobody", password: "whatever1" } }))).status, 401);

  // Registration: 5 accounts per hour per IP.
  for (let i = 0; i < 5; i++) {
    assert.equal((await call("POST", "/api/auth/register", opt({ ip: "198.51.100.3", body: { username: `user${i}`, password: "long enough" } }))).status, 201);
  }
  assert.equal((await call("POST", "/api/auth/register", opt({ ip: "198.51.100.3", body: { username: "user9", password: "long enough" } }))).status, 429);

  // Deck writes: 10 per minute per user; listing: 30 per minute per user.
  const token = (await call("POST", "/api/auth/login", opt({ ip: "198.51.100.4", body: { username: "user0", password: "long enough" } }))).body.token;
  const created = [];
  for (let i = 0; i < 10; i++) {
    const r = await call("POST", "/api/decks", opt({ token, body: { name: `D${i}`, ydk: YDK } }));
    assert.equal(r.status, 201);
    created.push(r.body.deck.id);
  }
  assert.equal((await call("DELETE", `/api/decks/${created[0]}`, opt({ token }))).status, 429);
  for (let i = 0; i < 30; i++) assert.equal((await call("GET", "/api/decks", opt({ token }))).status, 200);
  assert.equal((await call("GET", "/api/decks", opt({ token }))).status, 429);

  // General: 120 requests per minute per user.
  clock += 60_001;
  let last;
  for (let i = 0; i < 121; i++) last = await call("GET", "/api/auth/me", opt({ token }));
  assert.equal(last.status, 429);

  // Without a session: 60 requests per minute per IP.
  clock += 60_001;
  for (let i = 0; i < 60; i++) assert.equal((await call("GET", "/api/auth/me", opt({ ip: "198.51.100.9" }))).status, 401);
  assert.equal((await call("GET", "/api/auth/me", opt({ ip: "198.51.100.9" }))).status, 429);
});

/* ---------------- cleanup and backups ---------------- */

test("accounts inactive for 90 days are deleted with their sessions and decks", async () => {
  const oldToken = await signUp("old", "old password");
  await call("POST", "/api/decks", { token: oldToken, body: { name: "Old deck", ydk: YDK } });
  clock += 60 * DAY;
  const fresh = await signUp("fresh", "fresh password");
  await call("POST", "/api/decks", { token: fresh, body: { name: "New deck", ydk: YDK } });

  // Day 89 for "old": still there (only its long-expired session goes).
  clock += 29 * DAY;
  assert.equal(cleanup(db, clock).users, 0);
  // Past 90 days of inactivity: gone, with everything it owned.
  clock += 2 * DAY;
  const removed = cleanup(db, clock);
  assert.equal(removed.users, 1);
  assert.deepEqual(db.prepare("SELECT username FROM users").all().map((u) => u.username), ["fresh"]);
  assert.deepEqual(db.prepare("SELECT name FROM decks").all().map((d) => d.name), ["New deck"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'old'").get().n, 0);
  assert.equal((await call("GET", "/api/auth/me", { token: oldToken })).status, 401);
  assert.equal(INACTIVE_DAYS, 90);
});

test("using the account counts as activity", async () => {
  const token = await signUp();
  clock += 20 * DAY;
  assert.equal((await call("GET", "/api/decks", { token })).status, 200); // activity on day 20
  clock += 80 * DAY;
  assert.equal(cleanup(db, clock).users, 0, "80 days since the last request");
  // Signing in again counts too.
  assert.equal((await call("POST", "/api/auth/login", { body: { username: "alice", password: "correct horse" } })).status, 200);
  clock += 80 * DAY;
  assert.equal(cleanup(db, clock).users, 0, "80 days since the last login");
  clock += 11 * DAY;
  assert.equal(cleanup(db, clock).users, 1, "91 days since the last login");
});

test("expired sessions are cleaned up", async () => {
  await signUp();
  clock += 31 * DAY;
  assert.equal(cleanup(db, clock).sessions, 1);
});

test("backups are consistent copies and only the newest 7 are kept", async () => {
  await signUp();
  const bdir = join(dir, "backups");
  for (let i = 0; i < BACKUPS_KEPT + 3; i++) backup(db, bdir, new Date(Date.UTC(2026, 0, 1 + i)));
  const files = readdirSync(bdir).sort();
  assert.equal(files.length, BACKUPS_KEPT);
  assert.equal(files[0], "accounts-20260104-000000.db");
  const copy = await openDatabase(join(bdir, files[files.length - 1]));
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
  copy.close();
});

test("a forged X-Forwarded-For can't dodge per-IP limits", async (t) => {
  const { acc, srv, base: rl } = await startServer(LIMITS);
  t.after(() => {
    acc.close();
    srv.close();
  });
  // The client adds a fake address in front; the reverse proxy appends the real one last.
  for (let i = 0; i < 5; i++) {
    const r = await call("POST", "/api/auth/login", { server: rl, ip: `10.0.0.${i}, 192.0.2.50`, body: { username: "nobody", password: "whatever1" } });
    assert.equal(r.status, 401);
  }
  const r = await call("POST", "/api/auth/login", { server: rl, ip: "10.9.9.9, 192.0.2.50", body: { username: "nobody", password: "whatever1" } });
  assert.equal(r.status, 429);
});

/* ---------------- hardening ---------------- */

test("failed logins are limited per username, from any IP", async (t) => {
  const { acc, srv, base: rl } = await startServer({ ...LOOSE, loginUser: LIMITS.loginUser });
  t.after(() => {
    acc.close();
    srv.close();
  });
  await call("POST", "/api/auth/register", { server: rl, body: { username: "target", password: "the real one" } });
  // A successful login doesn't count.
  assert.equal((await call("POST", "/api/auth/login", { server: rl, body: { username: "target", password: "the real one" } })).status, 200);
  for (let i = 0; i < LIMITS.loginUser.limit; i++) {
    const r = await call("POST", "/api/auth/login", { server: rl, ip: `198.18.0.${i}`, body: { username: "TARGET", password: `guess ${i}xx` } });
    assert.equal(r.status, 401);
  }
  // Blocked from every IP, even with the right password; other accounts aren't affected.
  const blocked = await call("POST", "/api/auth/login", { server: rl, ip: "198.18.1.1", body: { username: "target", password: "the real one" } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal((await call("POST", "/api/auth/login", { server: rl, ip: "198.18.1.1", body: { username: "other", password: "whatever1" } })).status, 401);
  clock += LIMITS.loginUser.windowMs + 1;
  assert.equal((await call("POST", "/api/auth/login", { server: rl, ip: "198.18.1.1", body: { username: "target", password: "the real one" } })).status, 200);
});

test("IPv6 clients are limited per /64", async (t) => {
  assert.equal(ipKey("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(ipKey("2001:0DB8:0001:0002:ffff:ffff:ffff:ffff"), "2001:db8:1:2::/64");
  assert.equal(ipKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(ipKey("::1"), "0:0:0:0::/64");
  assert.equal(ipKey("::ffff:192.0.2.7"), "192.0.2.7");
  assert.equal(ipKey("192.0.2.7"), "192.0.2.7");

  const { acc, srv, base: rl } = await startServer(LIMITS);
  t.after(() => {
    acc.close();
    srv.close();
  });
  for (let i = 1; i <= 5; i++) {
    const r = await call("POST", "/api/auth/login", { server: rl, ip: `2001:db8:5:6::${i.toString(16)}`, body: { username: `n${i}body`, password: "whatever1" } });
    assert.equal(r.status, 401);
  }
  const r = await call("POST", "/api/auth/login", { server: rl, ip: "2001:db8:5:6:dead:beef:0:1", body: { username: "nobody6", password: "whatever1" } });
  assert.equal(r.status, 429, "another address in the same /64 is the same client");
  const other = await call("POST", "/api/auth/login", { server: rl, ip: "2001:db8:5:7::1", body: { username: "nobody7", password: "whatever1" } });
  assert.equal(other.status, 401, "the next /64 is a different client");
});

test("password checks when deleting the account are limited", async (t) => {
  const { acc, srv, base: rl } = await startServer({ ...LOOSE, password: LIMITS.password });
  t.after(() => {
    acc.close();
    srv.close();
  });
  const token = (await call("POST", "/api/auth/register", { server: rl, body: { username: "keeper", password: "keep it safe" } })).body.token;
  for (let i = 0; i < LIMITS.password.limit; i++) {
    assert.equal((await call("DELETE", "/api/auth/account", { server: rl, token, body: { password: `wrong ${i}xxx` } })).status, 401);
  }
  assert.equal((await call("DELETE", "/api/auth/account", { server: rl, token, body: { password: "keep it safe" } })).status, 429);
  assert.equal((await call("GET", "/api/auth/me", { server: rl, token })).status, 200, "the account is still there");
});

test("oversized bodies get 413, with or without Content-Length", async () => {
  const token = await signUp();
  const big = JSON.stringify({ name: "Big", ydk: "#main\n" + "1\n".repeat(150_000) });
  // With Content-Length.
  assert.equal((await call("POST", "/api/decks", { token, raw: big })).status, 413);
  // Chunked (no Content-Length): the reply must still arrive.
  const status = await new Promise((resolve) => {
    const u = new URL(base);
    const req = http.request(
      {
        host: u.hostname,
        port: u.port,
        path: "/api/decks",
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Forwarded-For": "203.0.113.1" },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", () => resolve(0));
    for (let i = 0; i * 10_000 < big.length; i++) req.write(big.slice(i * 10_000, (i + 1) * 10_000));
    req.end();
  });
  assert.equal(status, 413);
  // The server keeps working.
  assert.equal((await call("GET", "/api/decks", { token })).status, 200);
});

test("at most 4 password hashes run at once; the rest get 503", async () => {
  const results = await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      call("POST", "/api/auth/login", { ip: `198.19.0.${i}`, body: { username: `flood${i}`, password: "whatever1" } }),
    ),
  );
  const statuses = results.map((r) => r.status);
  assert.ok(statuses.every((s) => s === 401 || s === 503), statuses.join());
  assert.ok(statuses.includes(503), statuses.join());
  assert.ok(statuses.filter((s) => s === 401).length >= MAX_SCRYPT_JOBS, statuses.join());
  assert.ok(Number(results.find((r) => r.status === 503).headers.get("retry-after")) > 0);
  // Afterwards, sign-in works normally.
  await signUp();
  assert.equal((await call("POST", "/api/auth/login", { body: { username: "alice", password: "correct horse" } })).status, 200);
});
