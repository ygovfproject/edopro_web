// Decoding of STOC_GAME_MSG payloads.
//
// Most payloads are raw ocgcore messages and are parsed by the vendored
// ocgcore-wasm reader. A few are synthesised by the server (Multirole) and use
// their own layout: MSG_START, MSG_UPDATE_DATA, MSG_UPDATE_CARD, MSG_WAITING.

import { Reader } from "./binary";
import { readCardQuery, readLocationQuery, type CardQuery } from "./query";
import { BufferReader } from "../ocg/internal/buffer";
import { readMessage } from "../ocg/messages";
import { OcgMessageType, type OcgMessage } from "../ocg/type_message";

export { OcgMessageType };

export interface MsgStart {
  type: typeof OcgMessageType.START;
  /** Low nibble: which core player this client is (0 = goes first). 0xF0 bit: spectator. */
  playerType: number;
  lp: [number, number];
  deck: [number, number];
  extra: [number, number];
}

export interface MsgWaiting {
  type: typeof OcgMessageType.WAITING;
}

export interface MsgUpdateData {
  type: typeof OcgMessageType.UPDATE_DATA;
  player: number;
  location: number;
  cards: (CardQuery | null)[];
}

export interface MsgUpdateCard {
  type: typeof OcgMessageType.UPDATE_CARD;
  player: number;
  location: number;
  sequence: number;
  card: CardQuery | null;
}

export type ServerMessage =
  | MsgStart
  | MsgWaiting
  | MsgUpdateData
  | MsgUpdateCard
  | Exclude<OcgMessage, { type: typeof OcgMessageType.START | typeof OcgMessageType.WAITING | typeof OcgMessageType.UPDATE_DATA | typeof OcgMessageType.UPDATE_CARD }>;

export interface UnknownMessage {
  type: number;
  unknown: true;
  raw: Uint8Array;
}

export function parseGameMessage(body: Uint8Array): ServerMessage | UnknownMessage {
  if (body.length === 0) return { type: 0, unknown: true, raw: body };
  const type = body[0];
  const r = new Reader(body, 1);
  try {
    switch (type) {
      case OcgMessageType.WAITING:
        return { type: OcgMessageType.WAITING };
      case OcgMessageType.START: {
        const playerType = r.u8();
        const lp: [number, number] = [r.u32(), r.u32()];
        const d0 = r.u16();
        const e0 = r.u16();
        const d1 = r.u16();
        const e1 = r.u16();
        return { type: OcgMessageType.START, playerType, lp, deck: [d0, d1], extra: [e0, e1] };
      }
      case OcgMessageType.UPDATE_DATA: {
        const player = r.u8();
        const location = r.u8();
        return { type: OcgMessageType.UPDATE_DATA, player, location, cards: readLocationQuery(r) };
      }
      case OcgMessageType.UPDATE_CARD: {
        const player = r.u8();
        const location = r.u8();
        const sequence = r.u8();
        return { type: OcgMessageType.UPDATE_CARD, player, location, sequence, card: readCardQuery(r) };
      }
      default: {
        const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
        const msg = readMessage(new BufferReader(view));
        if (!msg) return { type, unknown: true, raw: body };
        return msg as ServerMessage;
      }
    }
  } catch {
    return { type, unknown: true, raw: body };
  }
}

export function isUnknown(m: ServerMessage | UnknownMessage): m is UnknownMessage {
  return (m as UnknownMessage).unknown === true;
}
