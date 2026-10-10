// EDOPro web proxy.
//
// The browser cannot open raw TCP sockets, so this service does exactly two
// things and nothing else:
//   1. Bridges a WebSocket from the browser to an EDOPro server's room-hosting
//      TCP port (bytes are passed through untouched; the browser speaks the
//      EDOPro protocol itself).
//   2. Fetches an EDOPro server's room list over HTTP and returns it with CORS
//      headers, because Multirole's lobby listing does not send any.
//
// Only servers listed in the config can be reached, so this is not an open
// proxy.

import http from "node:http";
import https from "node:https";
import net from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handshake, WebSocketConnection } from "./websocket.mjs";

const DEFAULTS = {
  host: "0.0.0.0",
  port: 7000,
  allowedOrigins: ["*"],
  trustProxy: false,
  maxConnectionsPerIp: 8,
  maxConnections: 1000,
  roomListCacheMs: 2000,
  servers: [],
};

export function loadConfig(path) {
  const file = resolve(path ?? process.env.PROXY_CONFIG ?? "config.json");
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Cannot read config ${file}: ${e.message}`);
  }
  cfg = { ...DEFAULTS, ...cfg };
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  const ids = new Set();
  for (const s of cfg.servers) {
    if (!s.id || !s.host || !s.port) throw new Error(`Server entry needs id, host and port: ${JSON.stringify(s)}`);
    if (ids.has(s.id)) throw new Error(`Duplicate server id ${s.id}`);
    ids.add(s.id);
  }
  return cfg;
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

export function createProxy(cfg) {
  const servers = new Map(cfg.servers.map((s) => [s.id, s]));
  const perIp = new Map();
  let total = 0;
  const roomCache = new Map(); // id -> { at, body, status }

  function clientIp(req) {
    if (cfg.trustProxy) {
      const xf = req.headers["x-forwarded-for"];
      if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  // Entries may be exact origins, "*", or use "*" as a wildcard (e.g. "http://localhost:*").
  const originPatterns = cfg.allowedOrigins.map(
    (o) => new RegExp("^" + o.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"),
  );

  function originAllowed(origin) {
    if (cfg.allowedOrigins.includes("*")) return true;
    return !!origin && originPatterns.some((re) => re.test(origin));
  }

  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (cfg.allowedOrigins.includes("*")) return { "Access-Control-Allow-Origin": "*" };
    if (origin && originAllowed(origin)) return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
    return {};
  }

  function sendJson(req, res, status, body) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(req),
    });
    res.end(JSON.stringify(body));
  }

  function fetchRoomList(server) {
    const cached = roomCache.get(server.id);
    if (cached && Date.now() - cached.at < cfg.roomListCacheMs) return Promise.resolve(cached);
    const url = server.roomListUrl ?? `http://${server.host}:${server.roomListPort ?? 7922}/api/getrooms`;
    const lib = url.startsWith("https:") ? https : http;
    return new Promise((resolveP) => {
      const req = lib.get(url, { timeout: 8000, headers: { "User-Agent": "edopro-web-proxy" } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            body = { rooms: [], error: "Invalid room list from server" };
          }
          const entry = { at: Date.now(), status: res.statusCode === 200 ? 200 : 502, body };
          roomCache.set(server.id, entry);
          resolveP(entry);
        });
        res.on("error", () => resolveP({ at: Date.now(), status: 502, body: { rooms: [], error: "Room list read failed" } }));
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", (e) => resolveP({ at: Date.now(), status: 502, body: { rooms: [], error: `Room list unavailable: ${e.message}` } }));
    });
  }

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...corsHeaders(req), "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "600" });
      return res.end();
    }
    if (req.method !== "GET") return sendJson(req, res, 405, { error: "Method not allowed" });
    if (req.headers.origin && !originAllowed(req.headers.origin)) {
      log(`request from origin ${req.headers.origin} is not in allowedOrigins; the browser will block it`);
    }
    if (url.pathname === "/healthz") return sendJson(req, res, 200, { ok: true, connections: total });
    if (url.pathname === "/api/servers") {
      return sendJson(req, res, 200, {
        servers: cfg.servers.map((s) => ({ id: s.id, name: s.name ?? s.id })),
      });
    }
    const m = url.pathname.match(/^\/api\/servers\/([^/]+)\/rooms$/);
    if (m) {
      const server = servers.get(decodeURIComponent(m[1]));
      if (!server) return sendJson(req, res, 404, { error: "Unknown server" });
      const r = await fetchRoomList(server);
      return sendJson(req, res, r.status, r.body);
    }
    sendJson(req, res, 404, { error: "Not found" });
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    const m = url.pathname.match(/^\/api\/servers\/([^/]+)\/connect$/);
    const reject = (code, text) => {
      socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    if (!m) return reject(404, "Not Found");
    const server = servers.get(decodeURIComponent(m[1]));
    if (!server) return reject(404, "Not Found");
    if (!originAllowed(req.headers.origin)) {
      log(`rejected WebSocket from origin ${req.headers.origin} (not in allowedOrigins)`);
      return reject(403, "Forbidden");
    }
    const ip = clientIp(req);
    const count = perIp.get(ip) ?? 0;
    if (count >= cfg.maxConnectionsPerIp || total >= cfg.maxConnections) return reject(429, "Too Many Requests");
    if (!handshake(req, socket)) return;

    perIp.set(ip, count + 1);
    total++;
    const ws = new WebSocketConnection(socket, head);
    const tcp = net.connect({ host: server.host, port: server.port });
    tcp.setNoDelay(true);
    tcp.setKeepAlive(true, 30000);
    let connected = false;
    const pending = [];
    let done = false;

    const cleanup = (reason) => {
      if (done) return;
      done = true;
      clearInterval(pinger);
      const c = (perIp.get(ip) ?? 1) - 1;
      if (c <= 0) perIp.delete(ip);
      else perIp.set(ip, c);
      total--;
      tcp.destroy();
      ws.close(1000, reason);
      log(`[${server.id}] ${ip} closed (${reason})`);
    };

    tcp.on("connect", () => {
      connected = true;
      for (const p of pending) tcp.write(p);
      pending.length = 0;
      log(`[${server.id}] ${ip} connected`);
    });
    tcp.on("data", (d) => ws.send(d));
    tcp.on("end", () => cleanup("server closed"));
    tcp.on("close", () => cleanup("server closed"));
    tcp.on("error", (e) => cleanup(`server error: ${e.code ?? e.message}`));
    ws.on("message", (d) => {
      if (connected) tcp.write(d);
      else pending.push(d);
    });
    ws.on("close", () => cleanup("client closed"));

    // Keep intermediaries (nginx, load balancers) from dropping idle duels.
    const pinger = setInterval(() => {
      if (!ws.alive) return cleanup("client timeout");
      ws.alive = false;
      ws.ping();
    }, 30000);
  });

  return httpServer;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const cfg = loadConfig(process.argv[2]);
  const server = createProxy(cfg);
  server.listen(cfg.port, cfg.host, () => {
    log(`EDOPro web proxy listening on ${cfg.host}:${cfg.port}`);
    for (const s of cfg.servers) log(`  server "${s.id}" -> ${s.host}:${s.port}`);
  });
}
