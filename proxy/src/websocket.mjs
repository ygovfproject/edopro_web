// Minimal RFC 6455 WebSocket server-side implementation (binary frames only).
// Zero dependencies: only node:crypto and the raw socket from an HTTP upgrade.

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE = 1 << 20; // 1 MiB is far above any EDOPro packet (max 64 KiB)

export function acceptKey(key) {
  return createHash("sha1").update(key + GUID).digest("base64");
}

/**
 * Completes the HTTP upgrade handshake. Returns false (and writes a 400) if
 * the request is not a valid WebSocket upgrade.
 */
export function handshake(req, socket) {
  const key = req.headers["sec-websocket-key"];
  const version = req.headers["sec-websocket-version"];
  const upgrade = (req.headers["upgrade"] || "").toLowerCase();
  if (!key || upgrade !== "websocket" || version !== "13") {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return false;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  return true;
}

export function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

/**
 * Wraps an upgraded socket. Emits:
 *  - "message" (Buffer) for each complete binary message
 *  - "close" () once, when the connection is gone
 */
export class WebSocketConnection extends EventEmitter {
  constructor(socket, head) {
    super();
    this.socket = socket;
    this.buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = 0;
    this.closed = false;
    this.alive = true;
    socket.setNoDelay(true);
    socket.on("data", (chunk) => {
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
      this.#parse();
    });
    socket.on("close", () => this.#finish());
    socket.on("error", () => this.#finish());
    if (this.buffer.length) queueMicrotask(() => this.#parse());
  }

  send(data) {
    if (this.closed) return;
    this.socket.write(encodeFrame(0x2, data));
  }

  ping() {
    if (this.closed) return;
    this.socket.write(encodeFrame(0x9));
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    const r = Buffer.from(reason, "utf8").subarray(0, 120);
    const payload = Buffer.alloc(2 + r.length);
    payload.writeUInt16BE(code, 0);
    r.copy(payload, 2);
    this.socket.write(encodeFrame(0x8, payload));
    this.socket.end();
    this.#finish();
  }

  #finish() {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.emit("close");
  }

  #parse() {
    while (!this.closed) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return this.close(1009, "too big");
        len = Number(big);
        off = 10;
      }
      if (!masked) return this.close(1002, "client frames must be masked");
      if (len > MAX_MESSAGE) return this.close(1009, "too big");
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      off += 4;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = buf[off + i] ^ mask[i & 3];
      this.buffer = buf.subarray(off + len);
      this.#handleFrame(fin, opcode, payload);
    }
  }

  #handleFrame(fin, opcode, payload) {
    switch (opcode) {
      case 0x0: // continuation
        if (!this.fragmentOpcode) return this.close(1002, "unexpected continuation");
        this.fragments.push(payload);
        if (fin) {
          const msg = Buffer.concat(this.fragments);
          const op = this.fragmentOpcode;
          this.fragments = [];
          this.fragmentOpcode = 0;
          if (op === 0x2) this.emit("message", msg);
        }
        return;
      case 0x1: // text: not used by this protocol, ignore
      case 0x2:
        if (!fin) {
          this.fragmentOpcode = opcode;
          this.fragments = [payload];
          return;
        }
        if (opcode === 0x2) this.emit("message", payload);
        return;
      case 0x8:
        this.close(1000);
        return;
      case 0x9:
        if (!this.closed) this.socket.write(encodeFrame(0xa, payload));
        return;
      case 0xa:
        this.alive = true;
        return;
      default:
        this.close(1002, "bad opcode");
    }
  }
}
