// Encoding of client-to-server (CTOS) packets and decoding of
// server-to-client (STOC) packets for the EDOPro / Multirole protocol.
//
// Wire format, both directions: u16 length (LE, counts the type byte and the
// body) | u8 type | body. Structs are laid out with natural C alignment.

import { Reader, Writer } from "./binary";
import { CTOS, ERRMSG, SERVER_HANDSHAKE, STOC } from "./constants";

export interface ClientVersion {
  client: [number, number];
  core: [number, number];
}

export interface DeckLimits {
  main: { min: number; max: number };
  extra: { min: number; max: number };
  side: { min: number; max: number };
}

export interface HostInfo {
  banlistHash: number;
  /** Allowed cards: 0 OCG, 1 TCG, 2 OCG/TCG, 3 with prerelease, 4 any. */
  rule: number;
  mode: number;
  duelRule: number;
  noCheckDeck: boolean;
  noShuffleDeck: boolean;
  startLp: number;
  startHand: number;
  drawCount: number;
  timeLimit: number;
  duelFlags: bigint;
  handshake: number;
  version: ClientVersion;
  team1: number;
  team2: number;
  bestOf: number;
  forbiddenTypes: number;
  extraRules: number;
  limits: DeckLimits;
}

export const HOST_INFO_SIZE = 68;

export function defaultHostInfo(version: ClientVersion): HostInfo {
  return {
    banlistHash: 0,
    rule: 2,
    mode: 0,
    duelRule: 0,
    noCheckDeck: false,
    noShuffleDeck: false,
    startLp: 8000,
    startHand: 5,
    drawCount: 1,
    timeLimit: 180,
    duelFlags: 0n,
    handshake: SERVER_HANDSHAKE,
    version,
    team1: 1,
    team2: 1,
    bestOf: 1,
    forbiddenTypes: 0,
    extraRules: 0,
    limits: { main: { min: 40, max: 60 }, extra: { min: 0, max: 15 }, side: { min: 0, max: 15 } },
  };
}

export function writeHostInfo(w: Writer, h: HostInfo) {
  const start = w.off;
  w.u32(h.banlistHash);
  w.u8(h.rule);
  w.u8(h.mode);
  w.u8(h.duelRule);
  w.u8(h.noCheckDeck ? 1 : 0);
  w.u8(h.noShuffleDeck ? 1 : 0);
  w.zeros(3); // padding to 12
  w.u32(h.startLp);
  w.u8(h.startHand);
  w.u8(h.drawCount);
  w.u16(h.timeLimit);
  w.u32(Number((h.duelFlags >> 32n) & 0xffffffffn));
  w.u32(h.handshake);
  writeVersion(w, h.version);
  w.i32(h.team1);
  w.i32(h.team2);
  w.i32(h.bestOf);
  w.u32(Number(h.duelFlags & 0xffffffffn));
  w.u32(h.forbiddenTypes);
  w.u16(h.extraRules);
  for (const k of ["main", "extra", "side"] as const) {
    w.u16(h.limits[k].min);
    w.u16(h.limits[k].max);
  }
  w.zeros(2); // tail padding to 68
  if (w.off - start !== HOST_INFO_SIZE) throw new Error("HostInfo size mismatch");
}

export function readHostInfo(r: Reader): HostInfo {
  const banlistHash = r.u32();
  const rule = r.u8();
  const mode = r.u8();
  const duelRule = r.u8();
  const noCheckDeck = r.u8() !== 0;
  const noShuffleDeck = r.u8() !== 0;
  r.skip(3);
  const startLp = r.u32();
  const startHand = r.u8();
  const drawCount = r.u8();
  const timeLimit = r.u16();
  const flagsHigh = r.u32();
  const handshake = r.u32();
  const version = readVersion(r);
  const team1 = r.i32();
  const team2 = r.i32();
  const bestOf = r.i32();
  const flagsLow = r.u32();
  const forbiddenTypes = r.u32();
  const extraRules = r.u16();
  const lim = () => ({ min: r.u16(), max: r.u16() });
  const limits = { main: lim(), extra: lim(), side: lim() };
  r.skip(2);
  return {
    banlistHash,
    rule,
    mode,
    duelRule,
    noCheckDeck,
    noShuffleDeck,
    startLp,
    startHand,
    drawCount,
    timeLimit,
    duelFlags: (BigInt(flagsHigh) << 32n) | BigInt(flagsLow),
    handshake,
    version,
    team1,
    team2,
    bestOf,
    forbiddenTypes,
    extraRules,
    limits,
  };
}

function writeVersion(w: Writer, v: ClientVersion) {
  w.u8(v.client[0]).u8(v.client[1]).u8(v.core[0]).u8(v.core[1]);
}

function readVersion(r: Reader): ClientVersion {
  return { client: [r.u8(), r.u8()], core: [r.u8(), r.u8()] };
}

/* ------------------------------------------------------------------ */
/* CTOS                                                                */
/* ------------------------------------------------------------------ */

export function packet(type: number, body: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(3 + body.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, body.length + 1, true);
  out[2] = type;
  out.set(body, 3);
  return out;
}

export const ctos = {
  playerInfo(name: string) {
    return packet(CTOS.PLAYER_INFO, new Writer(40).utf16(name, 20).finish());
  },
  createGame(info: HostInfo, roomName: string, password: string, notes: string) {
    const w = new Writer(348);
    writeHostInfo(w, info);
    w.utf16(roomName, 20);
    w.utf16(password, 20);
    const notesBytes = new TextEncoder().encode(notes).subarray(0, 199);
    w.bytes(notesBytes);
    w.zeros(200 - notesBytes.length);
    return packet(CTOS.CREATE_GAME, w.finish());
  },
  joinGame(roomId: number, password: string, version: ClientVersion) {
    const w = new Writer(52);
    // Legacy u16 version field: only checked by old YGOPro servers.
    w.u16(0x1362);
    w.zeros(2);
    w.u32(roomId);
    w.utf16(password, 20);
    writeVersion(w, version);
    return packet(CTOS.JOIN_GAME, w.finish());
  },
  /** `main` must contain main deck AND extra deck codes; the server splits them. */
  updateDeck(main: number[], side: number[]) {
    const w = new Writer(8 + 4 * (main.length + side.length));
    w.u32(main.length);
    w.u32(side.length);
    for (const c of main) w.u32(c);
    for (const c of side) w.u32(c);
    return packet(CTOS.UPDATE_DECK, w.finish());
  },
  response(data: Uint8Array) {
    return packet(CTOS.RESPONSE, data);
  },
  /** Rock-paper-scissors: 1 scissors, 2 rock, 3 paper (YGOPro convention). */
  handResult(choice: 1 | 2 | 3) {
    return packet(CTOS.HAND_RESULT, Uint8Array.of(choice));
  },
  /** goFirst=true sends 1. */
  tpResult(goFirst: boolean) {
    return packet(CTOS.TP_RESULT, Uint8Array.of(goFirst ? 1 : 0));
  },
  chat(text: string) {
    const clipped = text.slice(0, 255);
    const w = new Writer(2 * (clipped.length + 1));
    for (let i = 0; i < clipped.length; i++) w.u16(clipped.charCodeAt(i));
    w.u16(0);
    return packet(CTOS.CHAT, w.finish());
  },
  kick(pos: number) {
    return packet(CTOS.HS_KICK, Uint8Array.of(pos));
  },
  rematch(answer: boolean) {
    return packet(CTOS.REMATCH_RESPONSE, Uint8Array.of(answer ? 1 : 0));
  },
  simple(type: number) {
    return packet(type);
  },
};

/* ------------------------------------------------------------------ */
/* STOC                                                                */
/* ------------------------------------------------------------------ */

/** Splits a TCP byte stream into STOC packets. */
export class PacketSplitter {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): { type: number; body: Uint8Array }[] {
    if (this.buf.length === 0) this.buf = chunk.slice();
    else {
      const next = new Uint8Array(this.buf.length + chunk.length);
      next.set(this.buf);
      next.set(chunk, this.buf.length);
      this.buf = next;
    }
    const out: { type: number; body: Uint8Array }[] = [];
    let off = 0;
    while (this.buf.length - off >= 2) {
      const len = this.buf[off] | (this.buf[off + 1] << 8);
      if (this.buf.length - off < 2 + len) break;
      if (len >= 1) {
        out.push({ type: this.buf[off + 2], body: this.buf.slice(off + 3, off + 2 + len) });
      }
      off += 2 + len;
    }
    this.buf = this.buf.slice(off);
    return out;
  }
}

export type StocError =
  | { kind: "join"; code: number }
  | { kind: "deck"; code: number; got: number; min: number; max: number; card: number }
  | { kind: "side" }
  | { kind: "version"; version: ClientVersion | null };

export function decodeError(body: Uint8Array): StocError {
  const r = new Reader(body);
  const type = r.u8();
  switch (type) {
    case ERRMSG.JOINERROR: {
      r.skip(3);
      return { kind: "join", code: r.avail >= 4 ? r.u32() : 0 };
    }
    case ERRMSG.DECKERROR: {
      r.skip(3);
      if (r.avail >= 20) {
        const code = r.u32();
        const got = r.u32();
        const min = r.u32();
        const max = r.u32();
        const card = r.u32();
        return { kind: "deck", code, got, min, max, card };
      }
      // Legacy short form: code packs the card.
      return { kind: "deck", code: 0, got: 0, min: 0, max: 0, card: r.avail >= 4 ? r.u32() : 0 };
    }
    case ERRMSG.SIDEERROR:
      return { kind: "side" };
    case ERRMSG.VERERROR:
    case ERRMSG.VERERROR2:
    default: {
      if (body.length >= 8) {
        r.off = 4;
        return { kind: "version", version: readVersion(r) };
      }
      return { kind: "version", version: null };
    }
  }
}

export interface Chat2 {
  type: number;
  isTeam: boolean;
  name: string;
  message: string;
}

export const stoc = {
  joinGame(body: Uint8Array) {
    return readHostInfo(new Reader(body));
  },
  typeChange(body: Uint8Array) {
    const t = body[0];
    return { pos: t & 0xf, isHost: ((t >> 4) & 0xf) !== 0 };
  },
  playerEnter(body: Uint8Array) {
    const r = new Reader(body);
    const name = r.utf16(20);
    return { name, pos: r.u8() };
  },
  playerChange(body: Uint8Array) {
    const s = body[0];
    return { pos: (s >> 4) & 0xf, state: s & 0xf };
  },
  watchChange(body: Uint8Array) {
    return new Reader(body).u16();
  },
  timeLimit(body: Uint8Array) {
    const r = new Reader(body);
    const player = r.u8();
    r.skip(1);
    return { player, left: r.u16() };
  },
  handResult(body: Uint8Array) {
    return { me: body[0], opponent: body[1] };
  },
  createGame(body: Uint8Array) {
    return new Reader(body).u32();
  },
  chat2(body: Uint8Array): Chat2 {
    const r = new Reader(body);
    const type = r.u8();
    const isTeam = r.u8() !== 0;
    const name = r.utf16(20);
    const message = r.utf16(Math.min(256, r.avail >> 1));
    return { type, isTeam, name, message };
  },
  /** Legacy STOC_CHAT: u16 player + UTF-16 text. */
  chat(body: Uint8Array) {
    const r = new Reader(body);
    const player = r.u16();
    return { player, message: r.utf16(r.avail >> 1) };
  },
  catchUp(body: Uint8Array) {
    return body[0] !== 0;
  },
};

export { STOC, CTOS };
