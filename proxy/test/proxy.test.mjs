import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { createProxy } from "../src/server.mjs";

let tcpServer, roomServer, proxy, proxyPort;
const received = [];

before(async () => {
  // Fake EDOPro duel port: echoes everything back, records what it got.
  tcpServer = net.createServer((sock) => {
    sock.on("data", (d) => {
      received.push(Buffer.from(d));
      sock.write(d);
    });
  });
  await new Promise((r) => tcpServer.listen(0, "127.0.0.1", r));
  // Fake Multirole lobby listing (raw HTTP/1.0 like the real one).
  roomServer = net.createServer((sock) => {
    sock.once("data", () => {
      const body = JSON.stringify({ rooms: [{ roomid: 42, roomnotes: "hi", users: [] }] });
      sock.end(`HTTP/1.0 200 OK\r\nContent-Length: ${body.length}\r\nContent-Type: application/json\r\n\r\n${body}`);
    });
  });
  await new Promise((r) => roomServer.listen(0, "127.0.0.1", r));
  proxy = createProxy({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["*"],
    trustProxy: false,
    maxConnectionsPerIp: 2,
    maxConnections: 10,
    roomListCacheMs: 0,
    servers: [
      {
        id: "t",
        name: "Test",
        host: "127.0.0.1",
        port: tcpServer.address().port,
        roomListUrl: `http://127.0.0.1:${roomServer.address().port}/api/getrooms`,
      },
    ],
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  proxyPort = proxy.address().port;
});

after(() => {
  proxy.close();
  tcpServer.close();
  roomServer.close();
});

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${proxyPort}${path}`, (res) => {
      let t = "";
      res.on("data", (c) => (t += c));
      res.on("end", () => resolve({ status: res.statusCode, cors: res.headers["access-control-allow-origin"], body: JSON.parse(t) }));
    }).on("error", reject);
  });
}

function openWs(serverId = "t") {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/api/servers/${serverId}/connect`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(e);
  });
}

test("lists servers", async () => {
  const r = await getJson("/api/servers");
  assert.equal(r.status, 200);
  assert.equal(r.cors, "*");
  assert.deepEqual(r.body, { servers: [{ id: "t", name: "Test" }] });
});

test("relays room list with CORS", async () => {
  const r = await getJson("/api/servers/t/rooms");
  assert.equal(r.status, 200);
  assert.equal(r.cors, "*");
  assert.equal(r.body.rooms[0].roomid, 42);
});

test("unknown server is 404", async () => {
  const r = await getJson("/api/servers/nope/rooms");
  assert.equal(r.status, 404);
});

test("bridges binary data both ways, small and large frames", async () => {
  const ws = await openWs();
  const sizes = [3, 200, 70000];
  for (const size of sizes) {
    const payload = new Uint8Array(size);
    for (let i = 0; i < size; i++) payload[i] = (i * 7 + size) & 0xff;
    const echoed = [];
    let got = 0;
    const done = new Promise((resolve) => {
      ws.onmessage = (ev) => {
        const b = new Uint8Array(ev.data);
        echoed.push(b);
        got += b.length;
        if (got >= size) resolve();
      };
    });
    ws.send(payload);
    await done;
    const all = Buffer.concat(echoed.map((b) => Buffer.from(b)));
    assert.equal(all.length, size);
    assert.ok(all.equals(Buffer.from(payload)), `echo mismatch for size ${size}`);
  }
  ws.close();
});

test("enforces per-IP connection limit", async () => {
  const a = await openWs();
  const b = await openWs();
  await assert.rejects(openWs());
  a.close();
  b.close();
});

test("rejects unknown server on websocket", async () => {
  await assert.rejects(openWs("nope"));
});

/** Sends a raw HTTP request and returns the status line ("" if the connection died). */
function raw(request) {
  return new Promise((resolve) => {
    const sock = net.connect(proxyPort, "127.0.0.1", () => sock.write(request));
    let t = "";
    sock.on("data", (c) => (t += c));
    sock.on("close", () => resolve(t.split("\r\n")[0]));
    sock.on("error", () => resolve(""));
    sock.setTimeout(3000, () => sock.destroy());
  });
}

test("malformed URLs get 400 and don't stop the service", async () => {
  assert.match(await raw("GET /api/servers/%E0/rooms HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"), / 400 /);
  assert.match(await raw("GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"), / 400 /);
  const upgrade = (path) =>
    `GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`;
  assert.match(await raw(upgrade("/api/servers/%E0/connect")), / 400 /);
  assert.match(await raw(upgrade("//[")), / 400 /);
  // Still serving.
  assert.equal((await getJson("/api/servers")).status, 200);
});
