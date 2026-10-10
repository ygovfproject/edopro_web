// Encoders for duel responses (CTOS_RESPONSE payloads), matching what
// ygopro-core's playerop.cpp parses.

import { Writer } from "./binary";

export const IDLE = {
  SUMMON: 0,
  SPSUMMON: 1,
  REPOS: 2,
  MSET: 3,
  SSET: 4,
  ACTIVATE: 5,
  TO_BP: 6,
  TO_EP: 7,
  SHUFFLE: 8,
} as const;

export const BATTLE = {
  ACTIVATE: 0,
  ATTACK: 1,
  TO_M2: 2,
  TO_EP: 3,
} as const;

const i32 = (v: number) => new Writer(4).i32(v).finish();

export const respond = {
  idle(action: number, index = 0) {
    return i32((index << 16) | action);
  },
  battle(action: number, index = 0) {
    return i32((index << 16) | action);
  },
  yesNo(yes: boolean) {
    return i32(yes ? 1 : 0);
  },
  option(index: number) {
    return i32(index);
  },
  /** For SELECT_CARD, SELECT_TRIBUTE and SELECT_SUM: indices into the selectable list, or null to cancel. */
  cards(indices: number[] | null) {
    const w = new Writer(8 + 4 * (indices?.length ?? 0));
    if (indices === null) return w.i32(-1).finish();
    w.i32(0);
    w.u32(indices.length);
    for (const i of indices) w.u32(i);
    return w.finish();
  },
  /** SELECT_UNSELECT_CARD: index into select_cards ++ unselect_cards, or null to finish/cancel. */
  unselect(index: number | null) {
    if (index === null) return i32(-1);
    return new Writer(8).i32(1).i32(index).finish();
  },
  /** SELECT_CHAIN: index into the chain list, or null to not chain. */
  chain(index: number | null) {
    return i32(index === null ? -1 : index);
  },
  /** SELECT_PLACE / SELECT_DISFIELD: list of (player, location, sequence). */
  places(places: { player: number; location: number; sequence: number }[]) {
    const w = new Writer(3 * places.length);
    for (const p of places) w.u8(p.player).u8(p.location).u8(p.sequence);
    return w.finish();
  },
  position(position: number) {
    return i32(position);
  },
  counters(counts: number[]) {
    const w = new Writer(2 * counts.length);
    for (const c of counts) w.i16(c);
    return w.finish();
  },
  /**
   * SORT_CARD / SORT_CHAIN: for each card (in the order received), the slot
   * it should go to. null keeps the default order.
   */
  sort(order: number[] | null) {
    if (order === null) return Uint8Array.of(0xff);
    const w = new Writer(order.length);
    for (const o of order) w.i8(o);
    return w.finish();
  },
  race(mask: bigint) {
    return new Writer(8).u64(mask).finish();
  },
  attribute(mask: number) {
    return new Writer(4).u32(mask).finish();
  },
  card(code: number) {
    return new Writer(4).u32(code).finish();
  },
  /** ANNOUNCE_NUMBER: index of the chosen option. */
  number(index: number) {
    return i32(index);
  },
  /** In-duel rock paper scissors: 1 scissors, 2 rock, 3 paper. */
  rps(choice: number) {
    return i32(choice);
  },
};
