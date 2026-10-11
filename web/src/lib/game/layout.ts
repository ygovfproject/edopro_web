// Which zones exist on the field for a room's duel flags.
//  - MR4/MR5: Extra Monster Zones (M 5-6); Pendulum Zones are S/T 0 and 4.
//  - MR3: no EMZ; separate Pendulum Zones (S/T 6 and 7).
//  - MR1/MR2/GOAT: no EMZ, no Pendulum Zones.
//  - Speed/Rush: 3-column field, only zones 1-3 exist; no EMZ.

const DUEL_PZONE = 0x800n;
const DUEL_SEPARATE_PZONE = 0x1000n;
const DUEL_EMZONE = 0x2000n;
const DUEL_3_COLUMNS_FIELD = 0x400000n;

export interface FieldLayout {
  emz: boolean;
  separatePz: boolean;
  threeCols: boolean;
  /** S/T sequences of the left and right Pendulum Zones, or null if the rule has none. */
  pendulumZones: [number, number] | null;
  /** True if the zone (LOCATION_MZONE=4 / LOCATION_SZONE=8, sequence) is drawn on the board. */
  has(location: number, sequence: number): boolean;
}

export function fieldLayout(flags: bigint): FieldLayout {
  const emz = (flags & DUEL_EMZONE) !== 0n;
  const separatePz = (flags & DUEL_SEPARATE_PZONE) !== 0n;
  const threeCols = (flags & DUEL_3_COLUMNS_FIELD) !== 0n;
  const pzone = (flags & DUEL_PZONE) !== 0n;
  // Same as ygopro-core field::get_pzone_index.
  const pendulumZones: [number, number] | null = !pzone ? null : separatePz ? [6, 7] : threeCols ? [1, 3] : [0, 4];
  const main = (seq: number) => (threeCols ? seq >= 1 && seq <= 3 : seq >= 0 && seq <= 4);
  return {
    emz,
    separatePz,
    threeCols,
    pendulumZones,
    has(location, sequence) {
      if (location === 0x04) return main(sequence) || (emz && (sequence === 5 || sequence === 6));
      if (location === 0x08) return main(sequence) || sequence === 5 || (separatePz && (sequence === 6 || sequence === 7));
      return false;
    },
  };
}

const LINK = {
  BOTTOM_LEFT: 0x001,
  BOTTOM: 0x002,
  BOTTOM_RIGHT: 0x004,
  LEFT: 0x008,
  RIGHT: 0x020,
  TOP_LEFT: 0x040,
  TOP: 0x080,
  TOP_RIGHT: 0x100,
} as const;

export interface PointedZone {
  player: number;
  location: number; // 0x04 Monster Zone, 0x08 Spell & Trap Zone
  sequence: number;
}

/**
 * Zones a face-up Link Monster points to. Port of ygopro-core card::get_linked_zone
 * (Monster Zone part). `player` is the card's controller.
 */
export function linkedZones(player: number, sequence: number, marker: number, emz: boolean): PointedZone[] {
  const s = sequence;
  const has = (m: number) => (marker & m) !== 0;
  const out: PointedZone[] = [];
  const own = (location: number, seq: number) => out.push({ player, location, sequence: seq });
  const opp = (seq: number) => out.push({ player: 1 - player, location: 0x04, sequence: seq });
  if (s > 0 && s <= 4 && has(LINK.LEFT)) own(0x04, s - 1);
  if (s <= 3 && has(LINK.RIGHT)) own(0x04, s + 1);
  // Bottom markers of a Main Monster Zone point at nothing: Link Arrows only
  // point at Monster Zones (the Spell & Trap Zones below don't count).
  if (emz) {
    if ((s === 0 && has(LINK.TOP_RIGHT)) || (s === 1 && has(LINK.TOP)) || (s === 2 && has(LINK.TOP_LEFT))) {
      own(0x04, 5);
      opp(6);
    }
    if ((s === 2 && has(LINK.TOP_RIGHT)) || (s === 3 && has(LINK.TOP)) || (s === 4 && has(LINK.TOP_LEFT))) {
      own(0x04, 6);
      opp(5);
    }
    if (s === 5) {
      if (has(LINK.BOTTOM_LEFT)) own(0x04, 0);
      if (has(LINK.BOTTOM)) own(0x04, 1);
      if (has(LINK.BOTTOM_RIGHT)) own(0x04, 2);
      if (has(LINK.TOP_LEFT)) opp(4);
      if (has(LINK.TOP)) opp(3);
      if (has(LINK.TOP_RIGHT)) opp(2);
    }
    if (s === 6) {
      if (has(LINK.BOTTOM_LEFT)) own(0x04, 2);
      if (has(LINK.BOTTOM)) own(0x04, 3);
      if (has(LINK.BOTTOM_RIGHT)) own(0x04, 4);
      if (has(LINK.TOP_LEFT)) opp(2);
      if (has(LINK.TOP)) opp(1);
      if (has(LINK.TOP_RIGHT)) opp(0);
    }
  }
  return out;
}
