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
  /** "fly": from where it was; "fade": fades in; "cut": appears at once. */
  enter: "fly" | "fade" | "cut";
  /** When the card falls from above its zone into it (ms). Without it the card just lands. */
  dropAt?: number;
  /** Which way "above the zone" is on screen: -1 up (your side), 1 down (the opponent's). */
  dir: 1 | -1;
}

export const motion = {
  /** Cards that leave without flying to their new pile (destroyed, used as material). */
  vanish: new Set<number>(),
  /** Cards that stay invisible for `hold` ms where they land, then appear in place. */
  appear: new Map<number, { hold: number; style: AppearStyle }>(),
  /** Summoned cards with a custom arrival (lift above the zone, then drop). */
  land: new Map<number, LandPlan>(),
  clear() {
    this.vanish.clear();
    this.appear.clear();
    this.land.clear();
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
export function summonTimeline(kind: ExtraSummon, count: number): SummonTimeline {
  const n = Math.max(1, count);
  let reveal: number;
  let enter: "cut" | "fade" = "cut";
  let hits: number[] = [];
  switch (kind) {
    case "fusion":
      // The card swirls in at the fall point, then drops.
      reveal = 700;
      break;
    case "synchro":
      // Rings appear, spheres fall through them, a glowing silhouette, then the card.
      reveal = 1500;
      break;
    case "xyz": {
      // Spheres hit the zone one by one; the card shows above it after the last.
      const gap = Math.min(220, 700 / n);
      hits = Array.from({ length: n }, (_, i) => 300 + i * gap + 260);
      reveal = hits[n - 1] + 150;
      enter = "fade";
      break;
    }
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

/** Link Summon pace: every Link timing is multiplied by this (0.9 = 10% faster). */
export const LINK_SPEED = 0.9;
/** Link Summon: the materials vanish first; the Link frame shows up after this long. */
export const LINK_LEAD = Math.round(520 * LINK_SPEED);
/** ...and takes this long to appear. */
export const LINK_FRAME_IN = Math.round(260 * LINK_SPEED);

/** An attacker rushing into its target and back, at the end of the battle step. */
export const BUMP_MS = 560;
/** When in the bump it hits (fraction of BUMP_MS). */
export const BUMP_HIT = 0.42;

/** Level / Rank / Link Rating that makes the landing a big one. */
export const BIG_IMPACT_LEVEL = 7;

/* ---------- colours ---------- */

export const NEON_GREEN = "#39ff14";
export const NEON_BLUE = "#1ec8ff";
/** Glow colour of each Attribute (EARTH, WATER, FIRE, WIND, LIGHT, DARK, DIVINE). */
const ATTRIBUTE_COLORS: [number, string][] = [
  [0x01, "#c8964b"],
  [0x02, "#3d9bff"],
  [0x04, "#ff4a2e"],
  [0x08, "#4fe07a"],
  [0x10, "#fff07a"],
  [0x20, "#b44dff"],
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
