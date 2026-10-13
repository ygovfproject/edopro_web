/**
 * Hints from the board model to the card renderer about how a card should move
 * on its next render. Set while game messages are applied, read once by the
 * card's move animation. Also the shared timings of the summon animations, so
 * the card (CardImage) and the effects drawn around it (FxOverlay) stay in sync.
 */

/** How a hidden card shows up once its hold time is over. */
export type AppearStyle = "fade" | "pop" | "twist";

/** How a summoned card arrives in its zone. */
export interface LandPlan {
  /** Hidden for this long (ms) before it shows. */
  hold: number;
  /** "fly": from where it was; "fade": fades in; "grow": fades in growing from half size; "cut": appears at once. */
  enter: "fly" | "fade" | "grow" | "cut";
  /** When the card falls from above its zone into it (ms). Without it the card just lands. */
  dropAt?: number;
  /** Which way "above the zone" is on screen: -1 up (your side), 1 down (the opponent's). */
  dir: 1 | -1;
  /** Wind-up before the drop, by how hard it lands (the impact tier): 0 / none, 1, 2. */
  windup?: 0 | 1 | 2;
  /** The card shines in this colour from when it shows until it lands (Xyz: its Attribute; Ritual: blue). */
  glow?: string;
}

/** Wind-up before a summoned card drops, by impact tier: how much higher (card heights), how much bigger, how long (ms). */
export const WINDUP = [
  { rise: 0, grow: 0, ms: 0 },
  { rise: 0.22, grow: 0.05, ms: 200 },
  { rise: 0.45, grow: 0.1, ms: 280 },
] as const;

export const motion = {
  /** Cards that leave without flying to their new pile (destroyed, used as material). */
  vanish: new Set<number>(),
  /** Cards that stay invisible for `hold` ms where they land, then appear in place. */
  appear: new Map<number, { hold: number; style: AppearStyle }>(),
  /** Summoned cards with a custom arrival (lift above the zone, then drop). */
  land: new Map<number, LandPlan>(),
  /** Xyz Monsters being summoned: when (performance.now() ms) their materials may show under them (once landed). */
  materialsAt: new Map<number, number>(),
  /** Cards coming into a hand: the pile they come from ("player-location"), for cards not drawn there (e.g. not the Deck's top card)... */
  handFrom: new Map<number, string>(),
  /** ...and when (performance.now() ms) each starts to fly, so several go one after another. */
  handAt: new Map<number, number>(),
  clear() {
    this.handFrom.clear();
    this.handAt.clear();
    this.vanish.clear();
    this.appear.clear();
    this.land.clear();
    this.materialsAt.clear();
  },
};

/* ---------- shared timings (ms) ---------- */

/** Flight from hand / GY to the fall point. */
export const FLY_MS = 420;
/** A fade-in at the fall point (or in the zone). */
export const FADE_MS = 300;
/** A Special Summon from anywhere but the hand waits this long before fading in. */
export const FADE_IN_HOLD = 120;
/** Pause at the fall point before dropping. */
export const PAUSE_MS = 340;
/** The fall itself. */
export const DROP_MS = 140;
/** How far above the zone the fall point is, in card heights, and how big the card is there. */
export const LIFT = { rise: 0.62, scale: 1.2 };
/** Materials stay hidden in their new pile while their field animation plays. */
export const MATERIAL_HOLD = 950;

export type ExtraSummon = "fusion" | "synchro" | "xyz" | "link";
/** Summons with their own step-5 animation: the Extra Deck ones and Ritual Summons. */
export type SummonKind = ExtraSummon | "ritual";

export interface SummonTimeline {
  /** The card shows at the fall point. */
  reveal: number;
  enter: "cut" | "fade";
  /** The card starts to fall. */
  drop: number;
  /** It hits the zone. */
  impact: number;
  /** Xyz: when each sphere hits the zone. Link: when each Link Arrow lights up. */
  hits: number[];
}

/** Step 5 of each Extra Deck summon, 1-2 s in total. */
export function summonTimeline(kind: SummonKind, count: number): SummonTimeline {
  const n = Math.max(1, count);
  let reveal: number;
  let enter: "cut" | "fade" = "cut";
  let hits: number[] = [];
  switch (kind) {
    case "fusion":
      // The materials appear on a circle above the zone and spiral into its centre; out of
      // the light there the card swirls in, then drops.
      reveal = FUSION_MERGE + FUSION_SWIRL_MS;
      break;
    case "synchro":
      // Rings appear, spheres fall through them, a glowing silhouette, then the card.
      reveal = 1500;
      break;
    case "xyz": {
      // A vortex appears above the zone; the material spheres fall from above, circling the
      // line down to its centre, one by one (hits = when each reaches it); an explosion after the last, and the
      // card appears out of it in light, then drops.
      const gap = Math.min(300, 900 / n);
      hits = Array.from({ length: n }, (_, i) => XYZ_VORTEX_IN + i * gap + XYZ_FLY_MS);
      reveal = hits[n - 1] + 180;
      enter = "fade";
      break;
    }
    case "ritual":
      // A ring of blue flames appears; the card appears inside it in blue light, then drops.
      reveal = RITUAL_RING_IN + 150;
      enter = "fade";
      break;
    case "link": {
      // After the materials vanish (LINK_LEAD) the Link frame appears with every arrow dark,
      // the monster's arrows light up one by one, and the card fades in inside the frame.
      const gap = Math.min(240, 900 / n) * LINK_SPEED;
      hits = Array.from({ length: n }, (_, i) => LINK_LEAD + LINK_FRAME_IN + 150 * LINK_SPEED + i * gap);
      reveal = hits[n - 1] + 300 * LINK_SPEED;
      enter = "fade";
      break;
    }
  }
  const k = kind === "link" ? LINK_SPEED : 1;
  const settle = (enter === "fade" ? FADE_MS : 0) * k;
  // Link: the frame fades out before the card drops.
  const drop = reveal + settle + (kind === "link" ? Math.max(250, PAUSE_MS) : PAUSE_MS) * k;
  return { reveal, enter, drop, impact: drop + DROP_MS, hits };
}

/** Fusion Summon: the materials have spiralled into one point this long after the start... */
export const FUSION_MERGE = 1350;
/** ...and the Fusion Monster then takes this long to swirl in out of the light. */
export const FUSION_SWIRL_MS = 700;

/** Xyz Summon: the vortex takes this long to appear... */
export const XYZ_VORTEX_IN = 380;
/** ...and each material sphere this long to fall from the top of the field window onto it. */
export const XYZ_FLY_MS = 950;
/** Xyz materials leaving the field: each sphere shoots up out of the field window in this long... */
export const XYZ_UP_MS = 550;
/** ...and the next message waits this long, so the spheres leave one after another. */
export const XYZ_UP_STAGGER = 200;

/** Ritual Summon: how long the ring of blue flames takes to appear. */
export const RITUAL_RING_IN = 380;
/** Ritual blue (flames, light, the cell's glow on landing). */
export const RITUAL_BLUE = "#3f9bff";

/** Link Summon pace: every Link timing is multiplied by this (0.9 = 10% faster). */
export const LINK_SPEED = 0.9;
/** Link Summon: the materials vanish first; the Link frame shows up after this long. */
export const LINK_LEAD = Math.round(520 * LINK_SPEED);
/** ...and takes this long to appear. */
export const LINK_FRAME_IN = Math.round(260 * LINK_SPEED);

/** Cards added to a hand fly in one after another, this far apart (ms). */
export const HAND_STEP = 220;

/** A card flying into a pile it isn't drawn on top of, and a Deck being shuffled (ms). */
export const TO_PILE_MS = 460;
export const SHUFFLE_MS = 520;

/** An LP change: the number shows, waits, then hits the LP bar this long after it started. */
export const LP_HIT_MS = 1000;

/** An attacker stepping back, rushing into its target and back, at the end of the battle step. */
export const BUMP_MS = 860;
/** The step back (wind-up) before the rush ends here (fraction of BUMP_MS)... */
export const BUMP_WINDUP = 0.34;
/** ...and it hits here. */
export const BUMP_HIT = 0.63;

/** Level / Rank / Link Rating that makes the landing a big one. */
export const BIG_IMPACT_LEVEL = 7;

/* ---------- colours ---------- */

export const NEON_GREEN = "#39ff14";
export const NEON_BLUE = "#1ec8ff";
/** Colour of each Attribute: LIGHT white, DARK purple, WIND green, FIRE red, WATER blue, EARTH brown, DIVINE gold. */
const ATTRIBUTE_COLORS: [number, string][] = [
  [0x01, "#c58a3c"],
  [0x02, "#2f7dff"],
  [0x04, "#ff3b2f"],
  [0x08, "#2fe36a"],
  [0x10, "#ffffff"],
  [0x20, "#a43dff"],
  [0x40, "#ffcf3d"],
];
export function attributeColor(attribute: number): string {
  return ATTRIBUTE_COLORS.find(([bit]) => attribute & bit)?.[1] ?? "#e0e0e0";
}

/** How a selected material looks on the field while you pick Synchro/Xyz/Link materials. */
export interface PickForm {
  /** "glow": the card itself stays, white with a coloured glow (Link materials). */
  shape: "rings" | "spheres" | "sphere" | "swirl" | "glow";
  count: number;
  color: string;
}
