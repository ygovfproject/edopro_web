// Turns "what can I do now" prompts (SELECT_IDLECMD / SELECT_BATTLECMD /
// SELECT_PLACE) into per-card actions and selectable zones for the board UI.

import { OcgMessageType, type ServerMessage } from "../protocol/gamemsg";
import { respond, IDLE, BATTLE } from "../protocol/responses";
import { LOC, POS, type DuelCard, type DuelState } from "./duel";

export interface CardAction {
  label: string;
  response: Uint8Array;
  kind: "summon" | "spsummon" | "set" | "activate" | "repos" | "attack";
}

export interface LooseAction extends CardAction {
  code: number;
  location: number;
  controller: number;
}

export interface PhaseAction {
  label: string;
  response: Uint8Array;
}

export interface ActionMap {
  byCard: Map<number, CardAction[]>;
  /** Actions whose card isn't on the visible board (e.g. Xyz materials). */
  loose: LooseAction[];
  phase: PhaseAction[];
  /** Shuffle the hand (its own button, apart from the phase buttons). */
  shuffle?: PhaseAction;
}

export interface Describer {
  desc(desc: bigint, cardName?: string): string;
  name(code: number): string;
}

const CLIENT_MODE_RESOLVE = 1;
const CLIENT_MODE_RESET = 2;

function activateLabel(d: Describer, code: number, description: bigint, clientMode: number) {
  if (clientMode === CLIENT_MODE_RESOLVE) return "Resolve effect";
  if (clientMode === CLIENT_MODE_RESET) return "Reset effect";
  if (description === 0n) return "Activate";
  return d.desc(description, d.name(code));
}

export function actionsFor(msg: ServerMessage | null | undefined, duel: DuelState, d: Describer): ActionMap {
  const map: ActionMap = { byCard: new Map(), loose: [], phase: [] };
  if (!msg) return map;
  const add = (c: { code: number; controller: number; location: number; sequence: number }, a: CardAction) => {
    const card = duel.getCard({ controller: c.controller, location: c.location, sequence: c.sequence });
    if (card && (c.location & LOC.OVERLAY) === 0) {
      const list = map.byCard.get(card.id) ?? [];
      list.push(a);
      map.byCard.set(card.id, list);
    } else {
      map.loose.push({ ...a, code: c.code, location: c.location, controller: c.controller });
    }
  };
  const T = OcgMessageType;
  if (msg.type === T.SELECT_IDLECMD) {
    msg.summons.forEach((c, i) => add(c, { label: "Normal Summon", kind: "summon", response: respond.idle(IDLE.SUMMON, i) }));
    msg.special_summons.forEach((c, i) => add(c, { label: "Special Summon", kind: "spsummon", response: respond.idle(IDLE.SPSUMMON, i) }));
    msg.pos_changes.forEach((c, i) => {
      const card = duel.getCard({ controller: c.controller, location: c.location, sequence: c.sequence });
      const pos = card?.position ?? 0;
      const label = pos & POS.FACEDOWN ? "Flip Summon" : pos & POS.ATTACK ? "Change to Defense" : "Change to Attack";
      add(c, { label, kind: "repos", response: respond.idle(IDLE.REPOS, i) });
    });
    msg.monster_sets.forEach((c, i) => add(c, { label: "Set", kind: "set", response: respond.idle(IDLE.MSET, i) }));
    msg.spell_sets.forEach((c, i) => add(c, { label: "Set", kind: "set", response: respond.idle(IDLE.SSET, i) }));
    msg.activates.forEach((c, i) =>
      add(c, { label: activateLabel(d, c.code, c.description, c.client_mode), kind: "activate", response: respond.idle(IDLE.ACTIVATE, i) }),
    );
    if (msg.to_bp) map.phase.push({ label: "BP", response: respond.idle(IDLE.TO_BP) });
    if (msg.to_ep) map.phase.push({ label: "EP", response: respond.idle(IDLE.TO_EP) });
    if (msg.shuffle) map.shuffle = { label: "Shuffle hand", response: respond.idle(IDLE.SHUFFLE) };
  } else if (msg.type === T.SELECT_BATTLECMD) {
    msg.chains.forEach((c, i) =>
      add(c, { label: activateLabel(d, c.code, c.description, c.client_mode), kind: "activate", response: respond.battle(BATTLE.ACTIVATE, i) }),
    );
    msg.attacks.forEach((c, i) =>
      add(c, { label: c.can_direct ? "Attack (can attack directly)" : "Attack", kind: "attack", response: respond.battle(BATTLE.ATTACK, i) }),
    );
    if (msg.to_m2) map.phase.push({ label: "MP2", response: respond.battle(BATTLE.TO_M2) });
    if (msg.to_ep) map.phase.push({ label: "EP", response: respond.battle(BATTLE.TO_EP) });
  }
  return map;
}

export interface Zone {
  player: number;
  location: number;
  sequence: number;
}

/**
 * Zones selectable in SELECT_PLACE / SELECT_DISFIELD. The mask marks
 * *unavailable* zones relative to the selecting player: low 16 bits are their
 * own zones, high 16 bits the opponent's.
 */
export function selectableZones(selectingPlayer: number, fieldMask: number): Zone[] {
  const free = ~fieldMask >>> 0;
  const out: Zone[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (!(free & (1 << bit))) continue;
    const own = bit < 16;
    const b = bit & 15;
    const player = own ? selectingPlayer : 1 - selectingPlayer;
    if (b < 7) out.push({ player, location: LOC.MZONE, sequence: b });
    else if (b >= 8) out.push({ player, location: LOC.SZONE, sequence: b - 8 });
  }
  return out;
}

export function zoneKey(z: Zone) {
  return `${z.player}:${z.location}:${z.sequence}`;
}

/** Disabled zones from MSG_FIELD_DISABLED (mask relative to core player 0). */
export function disabledZoneKeys(duel: DuelState): Set<string> {
  const out = new Set<string>();
  const mask = duel.disabledZones >>> 0;
  for (let bit = 0; bit < 32; bit++) {
    if (!(mask & (1 << bit))) continue;
    const player = bit < 16 ? 0 : 1;
    const b = bit & 15;
    if (b < 7) out.add(zoneKey({ player, location: LOC.MZONE, sequence: b }));
    else if (b >= 8) out.add(zoneKey({ player, location: LOC.SZONE, sequence: b - 8 }));
  }
  return out;
}

/** Finds the card for a selection entry (code + location), creating a stub when it isn't tracked. */
export function cardAt(duel: DuelState, ref: { controller: number; location: number; sequence: number; overlay_sequence?: number }): DuelCard | null {
  return duel.getCard(ref);
}

/** EDOPro's select_sum_check: can the chosen cards (plus must-select) reach `acc`? */
export function sumCheck(params: number[], acc: number, exact: boolean): boolean {
  if (exact) {
    const rec = (i: number, s: number): boolean => {
      if (s > acc) return false;
      if (i === params.length) return s === acc;
      const o1 = params[i] & 0xffff;
      const o2 = params[i] >>> 16;
      return rec(i + 1, s + o1) || (o2 > 0 && rec(i + 1, s + o2));
    };
    return rec(0, 0);
  }
  let sum = 0;
  let mx = 0;
  let mn = 0x7fffffff;
  for (const p of params) {
    const o1 = p & 0xffff;
    const o2 = p >>> 16;
    const ms = o2 && o2 < o1 ? o2 : o1;
    sum += ms;
    mx += o2 > o1 ? o2 : o1;
    if (ms < mn) mn = ms;
  }
  return !(mx < acc || sum - mn >= acc);
}
