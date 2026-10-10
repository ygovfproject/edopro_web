// Parser for card query buffers (MSG_UPDATE_DATA / MSG_UPDATE_CARD).
//
// Each card is a list of blocks: u16 size (covers flag + data), u32 flag,
// data. A lone u16 0 means "no card in this slot". QUERY_END closes a card.
// Every block is skipped by its declared size, so unknown or oddly sized
// fields never desynchronise the stream.

import { Reader } from "./binary";

export const QUERY = {
  CODE: 0x1,
  POSITION: 0x2,
  ALIAS: 0x4,
  TYPE: 0x8,
  LEVEL: 0x10,
  RANK: 0x20,
  ATTRIBUTE: 0x40,
  RACE: 0x80,
  ATTACK: 0x100,
  DEFENSE: 0x200,
  BASE_ATTACK: 0x400,
  BASE_DEFENSE: 0x800,
  REASON: 0x1000,
  REASON_CARD: 0x2000,
  EQUIP_CARD: 0x4000,
  TARGET_CARD: 0x8000,
  OVERLAY_CARD: 0x10000,
  COUNTERS: 0x20000,
  OWNER: 0x40000,
  STATUS: 0x80000,
  IS_PUBLIC: 0x100000,
  LSCALE: 0x200000,
  RSCALE: 0x400000,
  LINK: 0x800000,
  IS_HIDDEN: 0x1000000,
  COVER: 0x2000000,
  END: 0x80000000,
} as const;

export interface LocRef {
  controller: number;
  location: number;
  sequence: number;
  position: number;
}

export interface CardQuery {
  flags: number;
  code?: number;
  position?: number;
  alias?: number;
  type?: number;
  level?: number;
  rank?: number;
  attribute?: number;
  race?: bigint;
  attack?: number;
  defense?: number;
  baseAttack?: number;
  baseDefense?: number;
  reason?: number;
  reasonCard?: LocRef;
  equipCard?: LocRef;
  targetCards?: LocRef[];
  overlayCards?: number[];
  /** counter type -> count */
  counters?: Record<number, number>;
  owner?: number;
  status?: number;
  isPublic?: boolean;
  lscale?: number;
  rscale?: number;
  link?: number;
  linkMarker?: number;
  isHidden?: boolean;
  cover?: number;
}

function readLoc(r: Reader): LocRef {
  return { controller: r.u8(), location: r.u8(), sequence: r.u32(), position: r.u32() };
}

/**
 * Reads a counted list. The core writes a u32 count, but some Multirole
 * versions re-serialise it as u16 followed by 2 bytes of padding at the end
 * of the block. The element count is derived from the block size, and the
 * layout is detected from which header matches it.
 */
function readList<T>(r: Reader, dataSize: number, elemSize: number, readElem: (r: Reader) => T): T[] {
  const start = r.off;
  const n = Math.max(0, Math.floor((dataSize - 4) / elemSize));
  const as32 = r.view.getUint32(start, true);
  const as16 = r.view.getUint16(start, true);
  r.off = start + (as32 === n ? 4 : as16 === n ? 2 : 4);
  const count = as32 === n || as16 === n ? n : Math.min(as32, n);
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(readElem(r));
  return out;
}

/** Reads one card's query. Returns null for an empty slot. */
export function readCardQuery(r: Reader): CardQuery | null {
  const first = r.u16();
  if (first === 0) return null;
  r.off -= 2;
  const q: CardQuery = { flags: 0 };
  while (r.avail >= 2) {
    const size = r.u16();
    if (size < 4) {
      // Malformed or an empty marker in the middle; stop this card.
      if (size !== 0) r.skip(Math.min(size, r.avail));
      break;
    }
    const blockStart = r.off;
    const flag = r.u32();
    const dataSize = size - 4;
    q.flags |= flag;
    if (flag === QUERY.END) break;
    const v = r;
    switch (flag) {
      case QUERY.CODE: q.code = v.u32(); break;
      case QUERY.POSITION: q.position = v.u32(); break;
      case QUERY.ALIAS: q.alias = v.u32(); break;
      case QUERY.TYPE: q.type = v.u32(); break;
      case QUERY.LEVEL: q.level = v.u32(); break;
      case QUERY.RANK: q.rank = v.u32(); break;
      case QUERY.ATTRIBUTE: q.attribute = v.u32(); break;
      case QUERY.RACE: q.race = dataSize >= 8 ? v.u64() : BigInt(v.u32()); break;
      case QUERY.ATTACK: q.attack = v.i32(); break;
      case QUERY.DEFENSE: q.defense = v.i32(); break;
      case QUERY.BASE_ATTACK: q.baseAttack = v.i32(); break;
      case QUERY.BASE_DEFENSE: q.baseDefense = v.i32(); break;
      case QUERY.REASON: q.reason = v.u32(); break;
      case QUERY.REASON_CARD: q.reasonCard = readLoc(v); break;
      case QUERY.EQUIP_CARD: q.equipCard = readLoc(v); break;
      case QUERY.TARGET_CARD: q.targetCards = readList(v, dataSize, 10, readLoc); break;
      case QUERY.OVERLAY_CARD: q.overlayCards = readList(v, dataSize, 4, (x) => x.u32()); break;
      case QUERY.COUNTERS: {
        const list = readList(v, dataSize, 4, (x) => x.u32());
        q.counters = {};
        for (const c of list) q.counters[c & 0xffff] = c >>> 16;
        break;
      }
      case QUERY.OWNER: q.owner = v.u8(); break;
      case QUERY.STATUS: q.status = v.u32(); break;
      case QUERY.IS_PUBLIC: q.isPublic = v.u8() !== 0; break;
      case QUERY.LSCALE: q.lscale = v.u32(); break;
      case QUERY.RSCALE: q.rscale = v.u32(); break;
      case QUERY.LINK: q.link = v.u32(); q.linkMarker = v.u32(); break;
      case QUERY.IS_HIDDEN: q.isHidden = v.u8() !== 0; break;
      case QUERY.COVER: q.cover = v.u32(); break;
      default: break;
    }
    // Always resynchronise on the declared block size.
    r.off = Math.min(blockStart + size, r.length);
  }
  return q;
}

/** Reads a location query: u32 total size, then one card query per slot. */
export function readLocationQuery(r: Reader): (CardQuery | null)[] {
  const total = r.u32();
  const end = Math.min(r.off + total, r.length);
  const out: (CardQuery | null)[] = [];
  while (r.off < end) out.push(readCardQuery(r));
  return out;
}
