// Client-side model of the duel board, rebuilt from the server's game
// messages. The server (Multirole + ocgcore) is authoritative; this only
// mirrors what the player is allowed to see, the same way EDOPro's
// ClientField does.

import { OcgMessageType, type ServerMessage } from "../protocol/gamemsg";
import {
  BIG_IMPACT_LEVEL,
  BUMP_MS,
  RITUAL_BLUE,
  DROP_MS,
  FADE_IN_HOLD,
  FADE_MS,
  FLY_MS,
  MATERIAL_HOLD,
  XYZ_UP_STAGGER,
  NEON_BLUE,
  NEON_GREEN,
  PAUSE_MS,
  attributeColor,
  motion,
  summonTimeline,
  type ExtraSummon,
  type PickForm,
} from "./motion";
import type { CardQuery } from "../protocol/query";

export const LOC = {
  DECK: 0x01,
  HAND: 0x02,
  MZONE: 0x04,
  SZONE: 0x08,
  GRAVE: 0x10,
  REMOVED: 0x20,
  EXTRA: 0x40,
  OVERLAY: 0x80,
  ONFIELD: 0x0c,
} as const;

export const POS = {
  FACEUP_ATTACK: 0x1,
  FACEDOWN_ATTACK: 0x2,
  FACEUP_DEFENSE: 0x4,
  FACEDOWN_DEFENSE: 0x8,
  FACEUP: 0x5,
  FACEDOWN: 0xa,
  ATTACK: 0x3,
  DEFENSE: 0xc,
} as const;

export const PHASE = {
  DRAW: 0x01,
  STANDBY: 0x02,
  MAIN1: 0x04,
  BATTLE_START: 0x08,
  BATTLE_STEP: 0x10,
  DAMAGE: 0x20,
  DAMAGE_CAL: 0x40,
  BATTLE: 0x80,
  MAIN2: 0x100,
  END: 0x200,
} as const;

let nextId = 1;

export interface DuelCard {
  /** Stable client-side id, used as a React key. */
  id: number;
  code: number;
  controller: number;
  location: number;
  sequence: number;
  position: number;
  alias: number;
  type: number;
  level: number;
  rank: number;
  attribute: number;
  race: bigint;
  attack: number;
  defense: number;
  baseAttack: number;
  baseDefense: number;
  lscale: number;
  rscale: number;
  link: number;
  linkMarker: number;
  status: number;
  owner: number;
  isPublic: boolean;
  isHidden: boolean;
  /** Set once a query has filled in stats for the current code. */
  hasStats: boolean;
  overlays: DuelCard[];
  counters: Record<number, number>;
  equipTarget: DuelCard | null;
  targets: Set<DuelCard>;
}

function newCard(controller: number, location: number, sequence: number, position: number, code = 0): DuelCard {
  return {
    id: nextId++,
    code,
    controller,
    location,
    sequence,
    position,
    alias: 0,
    type: 0,
    level: 0,
    rank: 0,
    attribute: 0,
    race: 0n,
    attack: 0,
    defense: 0,
    baseAttack: 0,
    baseDefense: 0,
    lscale: 0,
    rscale: 0,
    link: 0,
    linkMarker: 0,
    status: 0,
    owner: controller,
    isPublic: false,
    isHidden: false,
    hasStats: false,
    overlays: [],
    counters: {},
    equipTarget: null,
    targets: new Set(),
  };
}

export interface PlayerField {
  lp: number;
  deck: DuelCard[];
  hand: DuelCard[];
  mzone: (DuelCard | null)[];
  szone: (DuelCard | null)[];
  grave: DuelCard[];
  removed: DuelCard[];
  extra: DuelCard[];
}

function emptyField(): PlayerField {
  return {
    lp: 0,
    deck: [],
    hand: [],
    mzone: Array(7).fill(null),
    szone: Array(8).fill(null),
    grave: [],
    removed: [],
    extra: [],
  };
}

export interface ChainLink {
  code: number;
  controller: number;
  location: number;
  sequence: number;
  description: bigint;
  card: DuelCard | null;
  negated: boolean;
  /** Cards this link targets (MSG_BECOME_TARGET while it was activated). */
  targets: DuelCard[];
}

export interface LogEntry {
  id: number;
  text: string;
  codes: number[];
  player?: number;
  /** "turn": a new turn or phase (shown in red). */
  kind?: "turn";
}

/** A card shown to the player (confirmations, coin tosses...). */
export interface Reveal {
  id: number;
  title: string;
  codes: number[];
  /** "negated" shows the cards greyed out with a red cross. */
  kind?: "negated";
}

/** A card as an animation shows it. */
export interface FxCard {
  /** DuelCard id. */
  cardId: number;
  code: number;
  controller: number;
  faceDown: boolean;
  sideways: boolean;
}

export type SummonFx = ExtraSummon;

/** A one-off board animation. */
export interface Fx extends FxCard {
  id: number;
  kind: SummonFx | "ritual" | "material" | "destroy" | "battle" | "glow" | "impact" | "bump";
  /** Bump: the attack target (DuelCard id), or none for a direct attack at `toPlayer`. */
  targetId?: number;
  toPlayer?: number;
  /** Glow: the zone, its colour, when it starts (ms) and whether the card in it blinks. */
  zone?: { player: number; location: number; sequence: number };
  color?: string;
  delay?: number;
  blink?: boolean;
  /** Impact: 1 normal, 2 big (Level 7+). */
  tier?: 1 | 2;
  /** Fusion/Synchro/Xyz/Link summon: the materials used. */
  materials?: FxCard[];
  /** Link: the monster's Link Arrows. */
  linkMarker?: number;
  /** Which way "above the zone" is on screen (see LandPlan.dir). */
  dir?: 1 | -1;
  /** Material: how it looks while it leaves, and whether it was already shown like that while picked. */
  form?: PickForm;
  previewed?: boolean;
}

const REASON = {
  DESTROY: 0x1,
  MATERIAL: 0x8,
  BATTLE: 0x20,
  SPSUMMON: 0x800,
  FUSION: 0x40000,
  SYNCHRO: 0x80000,
  RITUAL: 0x100000,
  XYZ: 0x200000,
  LINK: 0x10000000,
} as const;
function popcount(n: number) {
  let c = 0;
  for (let x = n >>> 0; x; x &= x - 1) c++;
  return c;
}

function materialKind(reason: number): SummonFx | null {
  return reason & REASON.LINK
    ? "link"
    : reason & REASON.XYZ
      ? "xyz"
      : reason & REASON.SYNCHRO
        ? "synchro"
        : reason & REASON.FUSION
          ? "fusion"
          : null;
}

const TYPE_BITS = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  FUSION: 0x40,
  TUNER: 0x1000,
  SYNCHRO: 0x2000,
  XYZ: 0x800000,
  LINK: 0x4000000,
} as const;
/** Select hints (HINTMSG_*) the Synchro / Xyz / Link procedures use while you pick materials. */
const MATERIAL_HINTS: Record<string, SummonFx> = { "511": "fusion", "512": "synchro", "513": "xyz", "533": "link" };
/** Zone glow when a card activates or its chain link resolves. */
const ACTIVATE_COLORS = { monster: "#ffffff", spell: "#9ff5a6", trap: "#ff9fd2" };

export interface Formatter {
  name(code: number): string;
  desc(desc: bigint): string;
  phase(phase: number): string;
  winReason(reason: number): string;
  /** Card data from the database, if loaded. */
  info?(code: number): { type: number; linkMarker: number; level: number; attribute: number } | undefined;
}

const defaultFormatter: Formatter = {
  name: (c) => (c ? `#${c}` : "a card"),
  desc: (d) => `#${d}`,
  phase: (p) => `phase ${p}`,
  winReason: (r) => `reason ${r}`,
};

export interface LocationRef {
  controller: number;
  location: number;
  sequence: number;
  overlay_sequence?: number;
  position?: number;
}

export class DuelState {
  /** Core player index of this client (0 goes first). Spectators see player 0's side. */
  me = 0;
  isSpectator = false;
  started = false;
  players: [PlayerField, PlayerField] = [emptyField(), emptyField()];
  turn = 0;
  turnPlayer = 0;
  phase = 0;
  chain: ChainLink[] = [];
  solvingChain = 0;
  /** True between MSG_CHAINING and MSG_CHAINED: targets chosen now belong to the newest link. */
  private chainBuilding = false;
  disabledZones = 0;
  /** Current attack; `target` is null for a direct attack. Cleared when either card leaves the field. */
  attack: { from: LocationRef; to: LocationRef | null; attacker: DuelCard | null; target: DuelCard | null } | null = null;
  log: LogEntry[] = [];
  reveals: Reveal[] = [];
  fx: Fx[] = [];
  /** Materials sent since the last Special Summon: [message number, reason, card]. */
  private materials: { at: number; reason: number; card: FxCard }[] = [];
  /** Cards that already got a summon animation from their MOVE. */
  private summonFxCards = new Set<number>();
  /** How long (ms) the client should hold the next messages while a summon animation plays. */
  private hold = 0;
  /** Materials you have picked so far for a Synchro/Xyz/Link Summon, and how they look meanwhile. */
  materialPicks = new Map<number, PickForm>();
  private msgCount = 0;
  winner: { player: number; reason: number } | null = null;
  waiting = false;
  /** Last HINT_SELECTMSG, describing the next prompt. */
  selectHint: bigint = 0n;
  /** Countdown per core player, seconds (from STOC_TIME_LIMIT). */
  timeLeft: [number, number] = [0, 0];
  timePlayer = -1;
  rev = 0;
  private logId = 0;

  constructor(private fmt: Formatter = defaultFormatter) {}

  setFormatter(fmt: Formatter) {
    this.fmt = fmt;
  }

  /** Converts a core player index to the local view: 0 = bottom (me), 1 = top. */
  local(player: number) {
    return player === this.me ? 0 : 1;
  }

  /* ---------------- lookup ---------------- */

  pile(player: number, location: number): DuelCard[] | (DuelCard | null)[] | null {
    const f = this.players[player & 1];
    switch (location & 0x7f) {
      case LOC.DECK:
        return f.deck;
      case LOC.HAND:
        return f.hand;
      case LOC.MZONE:
        return f.mzone;
      case LOC.SZONE:
        return f.szone;
      case LOC.GRAVE:
        return f.grave;
      case LOC.REMOVED:
        return f.removed;
      case LOC.EXTRA:
        return f.extra;
      default:
        return null;
    }
  }

  getCard(ref: LocationRef): DuelCard | null {
    const pile = this.pile(ref.controller, ref.location);
    if (!pile) return null;
    const c = pile[ref.sequence] ?? null;
    if (c && ref.overlay_sequence !== undefined) return c.overlays[ref.overlay_sequence] ?? null;
    return c;
  }

  allCards(): DuelCard[] {
    const out: DuelCard[] = [];
    for (const f of this.players) {
      out.push(...f.deck, ...f.hand, ...f.grave, ...f.removed, ...f.extra);
      for (const c of [...f.mzone, ...f.szone]) {
        if (c) {
          out.push(c);
          out.push(...c.overlays);
        }
      }
    }
    return out;
  }

  private reindex(pile: DuelCard[]) {
    pile.forEach((c, i) => (c.sequence = i));
  }

  /** Removes the card at ref from its location and returns it. */
  private take(ref: LocationRef): DuelCard | null {
    if (ref.overlay_sequence !== undefined) {
      const holder = this.pile(ref.controller, ref.location)?.[ref.sequence] ?? null;
      if (!holder) return null;
      const [c] = holder.overlays.splice(ref.overlay_sequence, 1);
      holder.overlays.forEach((o, i) => (o.sequence = i));
      return c ?? null;
    }
    const pile = this.pile(ref.controller, ref.location);
    if (!pile) return null;
    if (ref.location & LOC.ONFIELD) {
      const c = pile[ref.sequence] ?? null;
      pile[ref.sequence] = null;
      return c;
    }
    const list = pile as DuelCard[];
    let idx = ref.sequence;
    if (ref.location === LOC.DECK && idx >= list.length) idx = list.length - 1;
    if (idx < 0 || idx >= list.length) return null;
    const [c] = list.splice(idx, 1);
    this.reindex(list);
    return c ?? null;
  }

  private put(card: DuelCard, ref: LocationRef) {
    card.controller = ref.controller;
    card.location = ref.location;
    if (ref.position !== undefined) card.position = ref.position;
    if (ref.overlay_sequence !== undefined) {
      const holder = this.pile(ref.controller, ref.location)?.[ref.sequence] ?? null;
      if (!holder) return;
      card.location = LOC.OVERLAY;
      card.position = POS.FACEUP_ATTACK;
      holder.overlays.splice(Math.min(ref.overlay_sequence, holder.overlays.length), 0, card);
      holder.overlays.forEach((o, i) => (o.sequence = i));
      return;
    }
    const pile = this.pile(ref.controller, ref.location);
    if (!pile) return;
    if (ref.location & LOC.ONFIELD) {
      card.sequence = ref.sequence;
      pile[ref.sequence] = card;
      return;
    }
    const list = pile as DuelCard[];
    const idx = Math.max(0, Math.min(ref.sequence, list.length));
    list.splice(idx, 0, card);
    this.reindex(list);
  }

  private addLog(text: string, codes: number[] = [], player?: number, kind?: LogEntry["kind"]) {
    this.log.push({ id: ++this.logId, text, codes, player, kind });
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
  }

  addReveal(title: string, codes: number[], kind?: Reveal["kind"]) {
    this.reveals.push({ id: ++this.logId, title, codes, kind });
  }

  addFx(fx: Omit<Fx, "id">) {
    this.fx.push({ id: ++this.logId, ...fx });
    if (this.fx.length > 40) this.fx.splice(0, this.fx.length - 40);
  }

  /** How a card looks as a material for this kind of summon (see PickForm). */
  private materialForm(kind: SummonFx, card: DuelCard, code: number): PickForm {
    const info = this.fmt.info?.(code || card.code);
    const level = Math.max(1, (card.hasStats ? card.level : 0) || (info?.level ?? 0) || 1);
    switch (kind) {
      case "synchro":
        return (info?.type ?? card.type) & TYPE_BITS.TUNER
          ? { shape: "rings", count: level, color: NEON_GREEN }
          : { shape: "spheres", count: level, color: NEON_GREEN };
      case "xyz":
        return { shape: "sphere", count: 1, color: attributeColor((card.hasStats ? card.attribute : 0) || (info?.attribute ?? 0)) };
      case "link":
        // Link: the card stays, turned white with a blue glow.
        return { shape: "glow", count: 1, color: NEON_BLUE };
      default:
        return { shape: "swirl", count: 1, color: "#b58cff" };
    }
  }

  /** The material prompt changed: the picked cards are the ones you can unselect. */
  syncMaterialPicks(msg: ServerMessage) {
    const kind = MATERIAL_HINTS[String(this.selectHint)];
    if (msg.type === OcgMessageType.SELECT_UNSELECT_CARD && kind && kind !== "fusion") {
      const next = new Map<number, PickForm>();
      for (const ref of msg.unselect_cards as (LocationRef & { code?: number })[]) {
        const card = this.getCard(ref);
        if (card && card.location & LOC.ONFIELD) next.set(card.id, this.materialForm(kind, card, ref.code ?? 0));
      }
      this.materialPicks = next;
    } else if (this.materialPicks.size) {
      // Another kind of prompt: the selection was cancelled (picked cards turn back).
      this.materialPicks = new Map();
    }
    this.rev++;
  }

  /** You clicked a card in the material prompt: show it picked (or not) right away. */
  pickMaterial(ref: LocationRef, picked: boolean) {
    const kind = MATERIAL_HINTS[String(this.selectHint)];
    const card = this.getCard(ref);
    if (!kind || kind === "fusion" || !card || !(card.location & LOC.ONFIELD)) return;
    const next = new Map(this.materialPicks);
    if (picked) next.set(card.id, this.materialForm(kind, card, card.code));
    else next.delete(card.id);
    this.materialPicks = next;
    this.rev++;
  }

  /** A card on the field activated: blink it and light its zone. */
  private activationGlow(card: DuelCard | null, ref: LocationRef) {
    if (!(ref.location & LOC.ONFIELD)) return;
    const t = (card?.hasStats ? card.type : 0) || (this.fmt.info?.(card?.code ?? 0)?.type ?? 0);
    const color = t & TYPE_BITS.TRAP ? ACTIVATE_COLORS.trap : t & TYPE_BITS.SPELL ? ACTIVATE_COLORS.spell : ACTIVATE_COLORS.monster;
    this.addFx({
      kind: "glow",
      cardId: card?.id ?? 0,
      code: card?.code ?? 0,
      controller: ref.controller,
      faceDown: false,
      sideways: false,
      zone: { player: ref.controller, location: ref.location & LOC.ONFIELD, sequence: ref.sequence },
      color,
      delay: 0,
      blink: true,
    });
  }

  /**
   * A monster arrived in a Monster Zone by a summon: plan how it lands (see LandPlan) and
   * which effects go with it. Normal/Ritual/Special Summons of Main Deck monsters: Level 5+
   * lifts above the zone and drops with an impact. Fusion/Synchro/Xyz/Link: their own
   * step-5 animation (see FxOverlay), then the drop.
   */
  private summonFx(card: DuelCard, from: LocationRef, to: LocationRef, code: number, reason: number) {
    const recent = this.materials.filter((m) => this.msgCount - m.at < 40);
    this.materials = [];
    const reasons = recent.reduce((acc, m) => acc | m.reason, 0);
    let kind = materialKind(reasons);
    const info = this.fmt.info?.(code);
    const type = info?.type ?? card.type;
    // Summoned from the face-down Extra Deck without tracked materials (e.g. Contact Fusion).
    if (!kind && from.location === LOC.EXTRA && !((from.position ?? 0) & POS.FACEUP)) {
      kind = type & TYPE_BITS.LINK ? "link" : type & TYPE_BITS.XYZ ? "xyz" : type & TYPE_BITS.SYNCHRO ? "synchro" : type & TYPE_BITS.FUSION ? "fusion" : null;
    }
    const dir: 1 | -1 = to.controller === this.me ? -1 : 1;
    const faceDown = !!((to.position ?? POS.FACEUP_ATTACK) & POS.FACEDOWN);
    const level = info?.level ?? card.level ?? 0;
    const base = { cardId: card.id, code, controller: to.controller, faceDown: false, sideways: false };
    const zone = { player: to.controller, location: LOC.MZONE, sequence: to.sequence };
    this.summonFxCards.add(card.id);

    // Ritual Summon (the tributes or the summon itself are marked Ritual): a ring of blue
    // flames, the card appears inside it in blue light, drops, and the cell glows blue.
    if (!kind && !faceDown && reason & REASON.SPSUMMON && (reasons | reason) & REASON.RITUAL) {
      const tl = summonTimeline("ritual", 1);
      motion.land.set(card.id, { hold: tl.reveal, enter: tl.enter, dropAt: tl.drop, dir });
      this.addFx({ ...base, kind: "ritual", dir });
      this.addFx({ ...base, kind: "impact", tier: level >= BIG_IMPACT_LEVEL ? 2 : 1, delay: tl.impact, dir });
      this.addFx({ ...base, kind: "glow", zone, color: RITUAL_BLUE, delay: tl.impact, blink: false });
      this.hold = Math.max(this.hold, tl.impact + 250);
      return;
    }

    if (!kind) {
      // Normal Summon, Ritual Summon, or any other Special Summon.
      if (faceDown) return;
      const special = !!(reason & REASON.SPSUMMON);
      const fromHand = from.location === LOC.HAND;
      // Any Special Summon that isn't a Fusion/Synchro/Xyz/Link Summon (Monster Reborn on any
      // monster, from the hand, Pendulum...) and every Normal Summon lifts above the zone,
      // waits and drops in. Only Level 5+ lands with an impact (ripple), bigger from Level 7.
      const tier = level >= BIG_IMPACT_LEVEL ? 2 : level >= 5 ? 1 : 0;
      const arrive = fromHand ? FLY_MS : FADE_IN_HOLD + FADE_MS;
      const dropAt = arrive + PAUSE_MS;
      motion.land.set(card.id, { hold: fromHand ? 0 : FADE_IN_HOLD, enter: fromHand ? "fly" : "fade", dropAt, dir });
      const landed = dropAt + DROP_MS;
      if (tier > 0) this.addFx({ ...base, kind: "impact", tier: tier as 1 | 2, delay: landed, dir });
      // Effects that follow (e.g. "when this card is summoned") wait until it has landed.
      this.hold = Math.max(this.hold, landed + (tier > 0 ? 250 : 80));
      if (special) {
        // The zone itself glows yellow for a Special Summon.
        this.addFx({ ...base, kind: "glow", zone, color: "#ffd54f", delay: landed, blink: false });
      }
      return;
    }

    const bit = { fusion: REASON.FUSION, synchro: REASON.SYNCHRO, xyz: REASON.XYZ, link: REASON.LINK }[kind];
    const materials = recent.filter((m) => m.reason & bit).map((m) => m.card);
    const linkMarker = info?.linkMarker ?? card.linkMarker;
    const arrows = Math.max(1, popcount(linkMarker));
    const tl = summonTimeline(kind, kind === "link" ? arrows : Math.max(1, materials.length));
    motion.land.set(card.id, { hold: tl.reveal, enter: tl.enter, dropAt: tl.drop, dir });
    this.addFx({ ...base, kind, materials, linkMarker, dir });
    const rank = kind === "link" ? popcount(linkMarker) : level;
    this.addFx({ ...base, kind: "impact", tier: rank >= BIG_IMPACT_LEVEL ? 2 : 1, delay: tl.impact, dir });
    // Effects that follow (e.g. "when this card is summoned") wait until it has landed.
    this.hold = Math.max(this.hold, tl.impact + 250);
  }

  /** Asked by the client after each packet: how long to wait before handling the next one. */
  takeHold(): number {
    const h = this.hold;
    this.hold = 0;
    return h;
  }

  dismissFx(id: number) {
    this.fx = this.fx.filter((f) => f.id !== id);
    this.rev++;
  }

  dismissReveal(id: number) {
    this.reveals = this.reveals.filter((r) => r.id !== id);
    this.rev++;
  }

  private who(player: number) {
    if (this.isSpectator) return player === 0 ? "Player 1" : "Player 2";
    return player === this.me ? "You" : "Opponent";
  }

  /* ---------------- queries ---------------- */

  applyQuery(card: DuelCard, q: CardQuery) {
    if (q.code !== undefined) {
      if (q.code !== card.code) card.hasStats = false;
      card.code = q.code;
    }
    if (q.position !== undefined) card.position = q.position;
    if (q.alias !== undefined) card.alias = q.alias;
    if (q.type !== undefined) card.type = q.type;
    if (q.level !== undefined) card.level = q.level;
    if (q.rank !== undefined) card.rank = q.rank;
    if (q.attribute !== undefined) card.attribute = q.attribute;
    if (q.race !== undefined) card.race = q.race;
    if (q.attack !== undefined) card.attack = q.attack;
    if (q.defense !== undefined) card.defense = q.defense;
    if (q.baseAttack !== undefined) card.baseAttack = q.baseAttack;
    if (q.baseDefense !== undefined) card.baseDefense = q.baseDefense;
    if (q.lscale !== undefined) card.lscale = q.lscale;
    if (q.rscale !== undefined) card.rscale = q.rscale;
    if (q.link !== undefined) card.link = q.link;
    if (q.linkMarker !== undefined) card.linkMarker = q.linkMarker;
    if (q.status !== undefined) card.status = q.status;
    if (q.owner !== undefined) card.owner = q.owner;
    if (q.isPublic !== undefined) card.isPublic = q.isPublic;
    if (q.isHidden !== undefined) card.isHidden = q.isHidden;
    if (q.counters) card.counters = { ...q.counters };
    if (q.attack !== undefined || q.type !== undefined) card.hasStats = true;
  }

  /* ---------------- message application ---------------- */

  /** Applies a game message. Returns true if it changed visible state. */
  apply(msg: ServerMessage): void {
    this.msgCount++;
    this.rev++;
    const T = OcgMessageType;
    switch (msg.type) {
      case T.START: {
        this.started = true;
        this.isSpectator = (msg.playerType & 0xf0) !== 0;
        this.me = msg.playerType & 0x0f ? 1 : 0;
        this.players = [emptyField(), emptyField()];
        this.chain = [];
        this.winner = null;
        // A new game of the match: nothing from the last one should still animate.
        this.fx = [];
        this.reveals = [];
        this.materials = [];
        this.summonFxCards.clear();
        this.materialPicks = new Map();
        motion.clear();
        this.turn = 0;
        this.phase = 0;
        this.attack = null;
        this.disabledZones = 0;
        for (const p of [0, 1]) {
          this.players[p].lp = msg.lp[p];
          for (let i = 0; i < msg.deck[p]; i++) this.players[p].deck.push(newCard(p, LOC.DECK, i, POS.FACEDOWN_DEFENSE));
          for (let i = 0; i < msg.extra[p]; i++) this.players[p].extra.push(newCard(p, LOC.EXTRA, i, POS.FACEDOWN_DEFENSE));
        }
        this.addLog("Duel started");
        break;
      }
      case T.WAITING:
        this.waiting = true;
        break;
      case T.UPDATE_DATA: {
        const pile = this.pile(msg.player, msg.location);
        if (!pile) break;
        if (msg.location === LOC.EXTRA || msg.location === LOC.DECK) {
          // Counts can drift when cards are created/destroyed; resize to match.
          const list = pile as DuelCard[];
          while (list.length < msg.cards.length) list.push(newCard(msg.player, msg.location, list.length, POS.FACEDOWN_DEFENSE));
        }
        msg.cards.forEach((q, i) => {
          if (!q) return;
          let card = pile[i] ?? null;
          if (!card) {
            if (msg.location & LOC.ONFIELD) {
              card = newCard(msg.player, msg.location, i, q.position ?? POS.FACEUP_ATTACK);
              (pile as (DuelCard | null)[])[i] = card;
            } else return;
          }
          this.applyQuery(card, q);
        });
        break;
      }
      case T.UPDATE_CARD: {
        const card = this.getCard({ controller: msg.player, location: msg.location, sequence: msg.sequence });
        if (card && msg.card) this.applyQuery(card, msg.card);
        break;
      }
      case T.HINT: {
        const hint = msg.hint;
        switch (msg.hint_type) {
          case 1: // EVENT
            this.addLog(this.fmt.desc(hint));
            break;
          case 2: // MESSAGE
            this.addReveal(this.fmt.desc(hint), []);
            this.addLog(this.fmt.desc(hint));
            break;
          case 3: // SELECTMSG
            this.selectHint = hint;
            break;
          case 4: // OPSELECTED
            this.addLog(`${this.who(msg.player)} selected: ${this.fmt.desc(hint)}`, [], msg.player);
            break;
          case 5: // EFFECT
            this.addLog(`Effect of ${this.fmt.name(Number(hint))}`, [Number(hint)]);
            break;
          case 6: // RACE
          case 7: // ATTRIB
            this.addLog(`${this.who(msg.player)} declared a ${msg.hint_type === 6 ? "type" : "attribute"}`, [], msg.player);
            break;
          case 8: // CODE
            this.addLog(`${this.who(msg.player)} declared ${this.fmt.name(Number(hint))}`, [Number(hint)], msg.player);
            break;
          case 9: // NUMBER
            this.addLog(`${this.who(msg.player)} declared ${hint}`, [], msg.player);
            break;
          case 10: // CARD
            this.addReveal(this.fmt.name(Number(hint)), [Number(hint)]);
            break;
          default:
            break;
        }
        break;
      }
      case T.WIN: {
        this.winner = { player: msg.player, reason: msg.reason };
        const text =
          msg.player > 1 ? "The duel ended in a draw" : msg.player === this.me && !this.isSpectator ? "You won!" : `${this.who(msg.player)} won`;
        this.addLog(`${text} (${this.fmt.winReason(msg.reason)})`);
        break;
      }
      case T.NEW_TURN:
        this.turn++;
        this.turnPlayer = msg.player;
        this.attack = null;
        this.addLog(`Turn ${this.turn}: ${this.who(msg.player)}`, [], msg.player, "turn");
        break;
      case T.NEW_PHASE:
        this.phase = msg.phase;
        this.attack = null;
        this.addLog(this.fmt.phase(msg.phase), [], undefined, "turn");
        break;
      case T.DRAW: {
        const f = this.players[msg.player];
        for (const d of msg.drawn) {
          const c = f.deck.pop() ?? newCard(msg.player, LOC.DECK, 0, POS.FACEDOWN_DEFENSE);
          c.code = d.code;
          c.position = d.position;
          c.location = LOC.HAND;
          c.controller = msg.player;
          f.hand.push(c);
        }
        this.reindex(f.hand);
        const known = msg.drawn.map((d) => d.code).filter(Boolean);
        this.addLog(
          `${this.who(msg.player)} drew ${msg.drawn.length} card${msg.drawn.length === 1 ? "" : "s"}${known.length ? `: ${known.map((c) => this.fmt.name(c)).join(", ")}` : ""}`,
          known,
          msg.player,
        );
        break;
      }
      case T.MOVE: {
        const from = msg.from as LocationRef;
        const to = msg.to as LocationRef;
        let card: DuelCard | null = null;
        if (from.location === 0) {
          card = newCard(to.controller, to.location, to.sequence, to.position ?? POS.FACEUP_ATTACK, msg.card);
        } else {
          card = this.take(from);
          if (!card) card = newCard(from.controller, from.location, from.sequence, from.position ?? 0, msg.card);
        }
        if (to.location === 0) {
          // Card left the game entirely (tokens).
          this.detach(card);
          break;
        }
        const fromPos = from.position ?? card.position;
        if (msg.reason & REASON.MATERIAL && from.location & (LOC.ONFIELD | LOC.HAND)) {
          const kind = materialKind(msg.reason);
          if (kind) {
            // Animated where it was (step 2), then fades in where it went.
            motion.vanish.add(card.id);
            motion.appear.set(card.id, { hold: MATERIAL_HOLD, style: "fade" });
            const picked = this.materialPicks.get(card.id);
            if (picked) {
              this.materialPicks = new Map(this.materialPicks);
              this.materialPicks.delete(card.id);
            }
            this.addFx({
              kind: "material",
              cardId: card.id,
              code: msg.card || card.code,
              controller: from.controller,
              faceDown: !!(from.location & LOC.ONFIELD && fromPos & POS.FACEDOWN),
              sideways: from.location === LOC.MZONE && !!(fromPos & POS.DEFENSE),
              form: picked ?? this.materialForm(kind, card, msg.card),
              previewed: !!picked,
            });
            // Xyz: the spheres shoot up out of the field one after another.
            if (kind === "xyz") this.hold = Math.max(this.hold, XYZ_UP_STAGGER);
          }
          this.materials.push({
            at: this.msgCount,
            reason: msg.reason,
            card: {
              cardId: card.id,
              code: msg.card || card.code,
              controller: from.controller,
              faceDown: !!(from.location & LOC.ONFIELD && fromPos & POS.FACEDOWN),
              sideways: from.location === LOC.MZONE && !!(fromPos & POS.DEFENSE),
            },
          });
        } else if (
          to.location === LOC.MZONE &&
          (msg.reason & REASON.SPSUMMON || (from.location === LOC.HAND && !((to.position ?? POS.FACEUP_ATTACK) & POS.FACEDOWN)))
        ) {
          this.summonFx(card, from, to, msg.card || card.code, msg.reason);
        }
        if (from.location & LOC.ONFIELD && msg.reason & REASON.DESTROY) {
          const pos = fromPos;
          motion.vanish.add(card.id);
          this.addFx({
            kind: msg.reason & REASON.BATTLE ? "battle" : "destroy",
            cardId: card.id,
            code: msg.card || card.code,
            controller: from.controller,
            faceDown: !!(pos & POS.FACEDOWN),
            sideways: from.location === LOC.MZONE && !!(pos & POS.DEFENSE),
          });
        }
        // The server blanks the code when the destination is hidden from us.
        card.code = msg.card;
        if (from.location & LOC.ONFIELD && !(to.location & LOC.ONFIELD)) {
          this.detach(card);
          // A destroyed attacker or attack target ends the attack arrow.
          if (this.attack && (this.attack.attacker === card || this.attack.target === card)) this.attack = null;
          // Materials leave with their holder; the server sends their own moves.
        }
        this.put(card, to);
        if ((to.location & LOC.ONFIELD) === 0) card.counters = {};
        if (msg.card && (to.location & (LOC.GRAVE | LOC.REMOVED))) {
          const where = to.location & LOC.GRAVE ? "the GY" : "banishment";
          if (from.location & (LOC.ONFIELD | LOC.HAND | LOC.DECK | LOC.EXTRA)) {
            this.addLog(`${this.fmt.name(msg.card)} was sent to ${where}`, [msg.card], to.controller);
          }
        }
        break;
      }
      case T.POS_CHANGE: {
        const card = this.getCard({ controller: msg.controller, location: msg.location, sequence: msg.sequence });
        if (card) {
          card.position = msg.position;
          if (msg.code) card.code = msg.code;
        }
        break;
      }
      case T.SET: {
        this.addLog(`${this.who(msg.controller)} set a card`, [], msg.controller);
        break;
      }
      case T.SWAP: {
        const a = this.getCard(msg.card1 as LocationRef);
        const b = this.getCard(msg.card2 as LocationRef);
        if (a && b) {
          const ra = { ...(msg.card1 as LocationRef), position: a.position };
          const rb = { ...(msg.card2 as LocationRef), position: b.position };
          this.take(ra);
          this.take(rb);
          this.put(a, rb);
          this.put(b, ra);
        }
        break;
      }
      case T.FIELD_DISABLED:
        this.disabledZones = msg.field_mask;
        break;
      case T.SUMMONING:
      case T.SPSUMMONING:
      case T.FLIPSUMMONING: {
        const card = this.getCard(msg as unknown as LocationRef);
        if (card && msg.code) card.code = msg.code;
        if (card) this.summonFxCards.delete(card.id);
        const verb = msg.type === T.SUMMONING ? "Normal Summoned" : msg.type === T.SPSUMMONING ? "Special Summoned" : "Flip Summoned";
        this.addLog(`${this.who(msg.controller)} ${verb} ${this.fmt.name(msg.code)}`, [msg.code], msg.controller);
        break;
      }
      case T.CHAINING: {
        const ref = msg as unknown as LocationRef;
        const card = this.getCard(ref);
        if (card && msg.code) card.code = msg.code;
        this.activationGlow(card, ref);
        this.chain.push({
          code: msg.code,
          controller: msg.triggering_controller,
          location: msg.triggering_location,
          sequence: msg.triggering_sequence,
          description: msg.description,
          card,
          negated: false,
          targets: [],
        });
        this.chainBuilding = true;
        this.addLog(`${this.who(msg.triggering_controller)} activated ${this.fmt.name(msg.code)} (chain link ${this.chain.length})`, [msg.code], msg.triggering_controller);
        break;
      }
      case T.CHAINED:
        this.chainBuilding = false;
        break;
      case T.BECOME_TARGET: {
        // Targets chosen while an effect is being activated: log them and bind them to it.
        const link = this.chainBuilding ? this.chain[this.chain.length - 1] : undefined;
        const targets = msg.cards.map((ref) => this.getCard(ref as LocationRef)).filter((c): c is DuelCard => !!c);
        if (!targets.length) break;
        if (link) for (const t of targets) if (!link.targets.includes(t)) link.targets.push(t);
        const named = targets.map((t) => this.targetName(t));
        const codes = [link?.code ?? 0, ...targets.map((t) => (this.isKnown(t) ? t.code : 0))].filter(Boolean);
        this.addLog(
          link ? `${this.fmt.name(link.code)} targets ${named.join(", ")}` : `Targeted: ${named.join(", ")}`,
          codes,
          link?.controller,
        );
        break;
      }
      case T.CHAIN_SOLVING:
        this.solvingChain = msg.chain_size;
        this.chainBuilding = false;
        break;
      case T.CHAIN_SOLVED:
        this.solvingChain = 0;
        // The resolved link (always the highest one left) loses its badge.
        if (this.chain.length >= msg.chain_size) this.chain = this.chain.slice(0, msg.chain_size - 1);
        break;
      case T.CHAIN_NEGATED:
      case T.CHAIN_DISABLED: {
        const link = this.chain[msg.chain_size - 1];
        if (link) {
          link.negated = true;
          this.addLog(`Chain link ${msg.chain_size} (${this.fmt.name(link.code)}) was negated`, [link.code]);
          this.addReveal(msg.type === T.CHAIN_NEGATED ? "Activation negated" : "Effect negated", [link.code], "negated");
        }
        break;
      }
      case T.CHAIN_END:
        this.chain = [];
        this.solvingChain = 0;
        this.chainBuilding = false;
        break;
      case T.SHUFFLE_DECK: {
        for (const c of this.players[msg.player].deck) {
          c.code = 0;
          c.position = POS.FACEDOWN_DEFENSE;
        }
        break;
      }
      case T.SHUFFLE_HAND: {
        const hand = this.players[msg.player].hand;
        msg.cards.forEach((code, i) => {
          if (hand[i]) hand[i].code = code;
        });
        break;
      }
      case T.SHUFFLE_EXTRA: {
        const facedown = this.players[msg.player].extra.filter((c) => !(c.position & POS.FACEUP));
        msg.cards.forEach((code, i) => {
          if (facedown[i]) facedown[i].code = code;
        });
        break;
      }
      case T.SWAP_GRAVE_DECK: {
        const f = this.players[msg.player];
        const grave = f.grave;
        const deck = f.deck;
        f.grave = deck.map((c) => ({ ...c, location: LOC.GRAVE, position: POS.FACEUP_ATTACK }));
        f.deck = grave.map((c) => ({ ...c, location: LOC.DECK, position: POS.FACEDOWN_DEFENSE }));
        const toExtra = new Set(msg.returned_to_extra);
        const stay: DuelCard[] = [];
        f.deck.forEach((c, i) => {
          if (toExtra.has(i)) {
            c.location = LOC.EXTRA;
            f.extra.push(c);
          } else stay.push(c);
        });
        f.deck = stay;
        this.reindex(f.grave);
        this.reindex(f.deck);
        this.reindex(f.extra);
        break;
      }
      case T.REVERSE_DECK: {
        for (const f of this.players) {
          f.deck.reverse();
          for (const c of f.deck) c.position = c.position & POS.FACEUP ? POS.FACEDOWN_DEFENSE : POS.FACEUP_DEFENSE;
          this.reindex(f.deck);
        }
        break;
      }
      case T.DECK_TOP: {
        const deck = this.players[msg.player].deck;
        const card = deck[deck.length - 1 - msg.count];
        if (card) {
          card.code = msg.code;
          card.position = msg.position;
        }
        break;
      }
      case T.SHUFFLE_SET_CARD: {
        const moved = msg.cards.map((c) => this.getCard(c.from as LocationRef));
        msg.cards.forEach((c, i) => {
          const card = moved[i];
          if (!card) return;
          const pile = this.pile(c.from.controller, c.from.location);
          if (pile && pile[c.from.sequence] === card) (pile as (DuelCard | null)[])[c.from.sequence] = null;
        });
        msg.cards.forEach((c, i) => {
          const card = moved[i];
          if (!card) return;
          card.code = 0;
          this.put(card, { ...(c.to as LocationRef), position: card.position });
        });
        break;
      }
      case T.CONFIRM_DECKTOP:
      case T.CONFIRM_EXTRATOP:
      case T.CONFIRM_CARDS: {
        const codes = msg.cards.map((c) => c.code);
        for (const c of msg.cards) {
          const card = this.getCard(c as LocationRef);
          if (card && c.code) card.code = c.code;
        }
        if (codes.length) {
          const where = msg.type === T.CONFIRM_DECKTOP ? "top of the Deck" : msg.type === T.CONFIRM_EXTRATOP ? "top of the Extra Deck" : "cards";
          this.addReveal(`${this.who(msg.player)} revealed ${where}`, codes);
          this.addLog(`Revealed: ${codes.map((c) => this.fmt.name(c)).join(", ")}`, codes, msg.player);
        }
        break;
      }
      case T.DAMAGE: {
        const f = this.players[msg.player];
        f.lp = Math.max(0, f.lp - msg.amount);
        this.addLog(`${this.who(msg.player)} took ${msg.amount} damage`, [], msg.player);
        break;
      }
      case T.RECOVER: {
        const f = this.players[msg.player];
        f.lp += msg.amount;
        this.addLog(`${this.who(msg.player)} gained ${msg.amount} LP`, [], msg.player);
        break;
      }
      case T.PAY_LPCOST: {
        const f = this.players[msg.player];
        f.lp = Math.max(0, f.lp - msg.amount);
        this.addLog(`${this.who(msg.player)} paid ${msg.amount} LP`, [], msg.player);
        break;
      }
      case T.LPUPDATE:
        this.players[msg.player].lp = msg.lp;
        break;
      case T.EQUIP: {
        const card = this.getCard(msg.card as LocationRef);
        const target = this.getCard(msg.target as LocationRef);
        if (card) card.equipTarget = target;
        break;
      }
      case T.CARD_TARGET: {
        const card = this.getCard(msg.card as LocationRef);
        const target = this.getCard(msg.target as LocationRef);
        if (card && target) card.targets.add(target);
        break;
      }
      case T.CANCEL_TARGET: {
        const card = this.getCard(msg.card as LocationRef);
        const target = this.getCard(msg.target as LocationRef);
        if (card && target) card.targets.delete(target);
        break;
      }
      case T.ADD_COUNTER:
      case T.REMOVE_COUNTER: {
        const card = this.getCard({ controller: msg.controller, location: msg.location, sequence: msg.sequence });
        if (card) {
          const cur = card.counters[msg.counter_type] ?? 0;
          const next = msg.type === T.ADD_COUNTER ? cur + msg.count : cur - msg.count;
          if (next > 0) card.counters[msg.counter_type] = next;
          else delete card.counters[msg.counter_type];
        }
        break;
      }
      case T.ATTACK: {
        const a = this.getCard(msg.card as LocationRef);
        const t = msg.target ? this.getCard(msg.target as LocationRef) : null;
        this.attack = { from: msg.card as LocationRef, to: (msg.target as LocationRef | null) ?? null, attacker: a, target: t };
        this.addLog(
          `${a ? this.fmt.name(a.code) : "A monster"} attacks ${t ? this.fmt.name(t.code) : "directly"}`,
          [a?.code ?? 0, t?.code ?? 0].filter(Boolean),
          msg.card.controller,
        );
        break;
      }
      case T.ATTACK_DISABLED:
        this.attack = null;
        this.addLog("The attack was negated");
        break;
      case T.DAMAGE_STEP_START: {
        // The battle step is over: the arrow goes and the attacker rushes into its target
        // (or at the opponent for a direct attack) and back. Damage waits for it.
        const atk = this.attack;
        // A target that left the field (replay) means no bump; a real direct attack bumps the player.
        if (atk?.attacker && atk.attacker.location === LOC.MZONE && (atk.target || !atk.to)) {
          const a = atk.attacker;
          this.addFx({
            kind: "bump",
            cardId: a.id,
            code: a.code,
            controller: a.controller,
            faceDown: false,
            sideways: false,
            targetId: atk.target && atk.target.location === LOC.MZONE ? atk.target.id : undefined,
            toPlayer: 1 - a.controller,
          });
          this.hold = Math.max(this.hold, BUMP_MS);
        }
        this.attack = null;
        break;
      }
      case T.DAMAGE_STEP_END:
        this.attack = null;
        break;
      case T.BATTLE:
        break;
      case T.TOSS_COIN:
        this.addLog(`${this.who(msg.player)} tossed a coin: ${msg.results.map((r) => (r ? "Heads" : "Tails")).join(", ")}`, [], msg.player);
        this.addReveal(`Coin toss: ${msg.results.map((r) => (r ? "Heads" : "Tails")).join(", ")}`, []);
        break;
      case T.TOSS_DICE:
        this.addLog(`${this.who(msg.player)} rolled: ${msg.results.join(", ")}`, [], msg.player);
        this.addReveal(`Dice roll: ${msg.results.join(", ")}`, []);
        break;
      case T.HAND_RES: {
        const names = ["", "Scissors", "Rock", "Paper"];
        this.addLog(`Rock-paper-scissors: ${names[msg.results[0]] ?? "?"} vs ${names[msg.results[1]] ?? "?"}`);
        break;
      }
      case T.TAG_SWAP: {
        const f = this.players[msg.player];
        f.deck = Array.from({ length: msg.deck_size }, (_, i) => newCard(msg.player, LOC.DECK, i, POS.FACEDOWN_DEFENSE));
        if (msg.deck_top_card && f.deck.length) f.deck[f.deck.length - 1].code = msg.deck_top_card;
        f.hand = msg.hand.map((h, i) => newCard(msg.player, LOC.HAND, i, h.position, h.code));
        f.extra = msg.extra.map((e, i) => newCard(msg.player, LOC.EXTRA, i, e.position, e.code));
        this.addLog(`${this.who(msg.player)} swapped duelists`, [], msg.player);
        break;
      }
      case T.RELOAD_FIELD: {
        this.players = [emptyField(), emptyField()];
        msg.players.forEach((p, pl) => {
          const f = this.players[pl];
          f.lp = p.lp;
          p.monsters.forEach((m, i) => {
            if (!m) return;
            const c = newCard(pl, LOC.MZONE, i, m.position);
            for (let k = 0; k < m.materials; k++) {
              const o = newCard(pl, LOC.OVERLAY, k, POS.FACEUP_ATTACK);
              c.overlays.push(o);
            }
            f.mzone[i] = c;
          });
          p.spells.forEach((s, i) => {
            if (!s) return;
            f.szone[i] = newCard(pl, LOC.SZONE, i, s.position);
          });
          const fill = (list: DuelCard[], n: number, loc: number, pos: number) => {
            for (let i = 0; i < n; i++) list.push(newCard(pl, loc, i, pos));
          };
          fill(f.deck, p.deck_size, LOC.DECK, POS.FACEDOWN_DEFENSE);
          fill(f.hand, p.hand_size, LOC.HAND, POS.FACEDOWN_DEFENSE);
          fill(f.grave, p.grave_size, LOC.GRAVE, POS.FACEUP_ATTACK);
          fill(f.removed, p.banish_size, LOC.REMOVED, POS.FACEUP_ATTACK);
          fill(f.extra, p.extra_size, LOC.EXTRA, POS.FACEDOWN_DEFENSE);
          for (let i = 0; i < p.extra_faceup_count && i < f.extra.length; i++) f.extra[f.extra.length - 1 - i].position = POS.FACEUP_ATTACK;
        });
        this.chain = msg.chain.map((c) => ({
          code: c.code,
          controller: c.triggering_controller,
          location: c.triggering_location,
          sequence: c.triggering_sequence,
          description: c.description,
          card: null,
          negated: false,
          targets: [],
        }));
        this.chainBuilding = false;
        break;
      }
      case T.REMOVE_CARDS: {
        for (const ref of msg.cards) {
          const c = this.take(ref as LocationRef);
          if (c) this.detach(c);
        }
        break;
      }
      case T.MATCH_KILL:
        this.addLog(`Match Kill by ${this.fmt.name(msg.card)}`, [msg.card]);
        break;
      case T.CARD_HINT:
      case T.PLAYER_HINT:
      case T.MISSED_EFFECT:
      case T.CARD_SELECTED:
      case T.RANDOM_SELECTED:
      case T.SUMMONED:
      case T.SPSUMMONED:
      case T.FLIPSUMMONED:
      case T.BE_CHAIN_TARGET:
      case T.CREATE_RELATION:
      case T.RELEASE_RELATION:
      case T.REFRESH_DECK:
      case T.AI_NAME:
      case T.SHOW_HINT:
      case T.CUSTOM_MSG:
      case T.RETRY:
      default:
        break;
    }
  }

  private isKnown(c: DuelCard) {
    return !!c.code && !((c.location & LOC.ONFIELD) && c.position & POS.FACEDOWN && c.controller !== this.me);
  }

  /** How a targeted card is named in the log, e.g. "Dark Magician" or "a face-down card (GY)". */
  private targetName(c: DuelCard) {
    const owner = this.isSpectator ? "" : c.controller === this.me ? "your " : "opponent's ";
    const name = this.isKnown(c) && !(c.position & POS.FACEDOWN && c.location & LOC.ONFIELD) ? this.fmt.name(c.code) : `${owner}face-down card`;
    const where =
      c.location & LOC.ONFIELD
        ? ""
        : c.location === LOC.GRAVE
          ? " (GY)"
          : c.location === LOC.REMOVED
            ? " (banished)"
            : c.location === LOC.HAND
              ? " (hand)"
              : c.location === LOC.DECK
                ? " (Deck)"
                : c.location === LOC.EXTRA
                  ? " (Extra Deck)"
                  : "";
    return name + where;
  }

  /** Clears equip/target links pointing at a card that left the field. */
  private detach(card: DuelCard) {
    card.equipTarget = null;
    card.targets.clear();
    for (const other of this.allCards()) {
      if (other.equipTarget === card) other.equipTarget = null;
      other.targets.delete(card);
    }
  }
}
