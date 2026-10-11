"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { CardImage, cardRect, forgetVanish, vanishRect } from "../CardImage";
import { useApp } from "../AppContext";
import type { Fx, FxCard } from "@/lib/game/duel";
import {
  BUMP_HIT,
  BUMP_MS,
  FADE_MS,
  LIFT,
  LINK_FRAME_IN,
  LINK_LEAD,
  LINK_SPEED,
  MATERIAL_HOLD,
  NEON_GREEN,
  attributeColor,
  summonTimeline,
  type ExtraSummon,
  type SummonTimeline,
} from "@/lib/game/motion";
import { LeavingForm, SynchroRing } from "./fx/MaterialForm";

/** The ring fills 80% of its image (see public/fx/synchro-ring.svg). */
const RING_IMAGE_FILL = 0.8;
/** Plain-style version of shinyDot for elements outside MUI: white ball, green shine. */
const shinyDotStyle = {
  background: "radial-gradient(circle at 42% 38%, #ffffff 0%, #ffffff 50%, #f4fff2 70%, rgba(255,255,255,.9) 100%)",
  boxShadow: `0 0 3px 1px #ffffff, 0 0 8px 3px #39ff14, 0 0 18px 7px #39ff14aa, 0 0 32px 12px #39ff1455`,
};
import { Swirl } from "./fx/Swirl";

/**
 * Board effects drawn on top of the page. When cards move, vanish or appear is decided
 * by the board model (lib/game/motion.ts); this draws what goes with it:
 *  - material:  a material leaving the field (Fusion swirl, Synchro rings/spheres,
 *               Xyz/Link spheres floating up)
 *  - fusion / synchro / xyz / link: step 5 of the summon, above the monster's zone
 *  - impact:    a summoned card landing in its zone: a ripple through the field cells
 *  - glow:      only timed here; the board draws it in the zone
 *  - destroy / battle: the card shattering / slashed in two
 */
export default function FxOverlay({ fx, me, onDone }: { fx: Fx[]; me: number; onDone: (id: number) => void }) {
  if (!fx.length) return null;
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 45, overflow: "hidden" }}>
      <style>{KEYFRAMES}</style>
      {fx.map((f) => (
        <FxItem key={f.id} fx={f} me={me} onDone={onDone} />
      ))}
    </div>
  );
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const isSummon = (k: Fx["kind"]): k is ExtraSummon => k === "fusion" || k === "synchro" || k === "xyz" || k === "link";

function popcount(n: number) {
  let c = 0;
  for (let x = n >>> 0; x; x &= x - 1) c++;
  return c;
}

/** Total time an effect stays mounted, ms. */
function lifetime(fx: Fx, tl: SummonTimeline | null): number {
  switch (fx.kind) {
    case "glow":
      return (fx.delay ?? 0) + 950;
    case "impact":
      return (fx.delay ?? 0) + 1300;
    case "material":
      // Shapes may first form (up to ~1.3 s), then leave one after another (~1 s).
      if (fx.form?.shape === "swirl") return MATERIAL_HOLD + 200;
      if (fx.form?.shape === "glow") return LINK_LEAD + 100;
      return (fx.previewed ? 0 : 1400) + 1200;
    case "destroy":
    case "battle":
      return 1000;
    case "bump":
      return BUMP_MS + 80;
    default:
      return (tl?.impact ?? 1500) + 500;
  }
}

function FxItem({ fx, me, onDone }: { fx: Fx; me: number; onDone: (id: number) => void }) {
  const { res } = useApp();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tl = useMemo(
    () => (isSummon(fx.kind) ? summonTimeline(fx.kind, fx.kind === "link" ? Math.max(1, popcount(fx.linkMarker ?? 0)) : Math.max(1, fx.materials?.length ?? 0)) : null),
    [fx],
  );
  useEffect(() => {
    const finish = () => {
      forgetVanish(fx.cardId);
      onDone(fx.id);
    };
    if (fx.kind === "glow") {
      // Drawn by the board in the zone; this only times it out.
      const t = setTimeout(finish, lifetime(fx, null));
      return () => clearTimeout(t);
    }
    // Runs after the board's layout effects, so card positions are known: where the card
    // is (summons, impacts) or was (materials, destroyed cards).
    const leaving = fx.kind === "material" || fx.kind === "destroy" || fx.kind === "battle";
    const r = leaving
      ? vanishRect(fx.cardId)
      : cardRect(fx.cardId) ?? document.querySelector(`[data-card-id="${fx.cardId}"]`)?.getBoundingClientRect();
    if (!r || !r.width || reducedMotion()) {
      finish();
      return;
    }
    setRect(r);
    const timers = [setTimeout(finish, lifetime(fx, tl))];
    if (fx.kind === "impact") {
      // The landing sends a ripple through the field, like a stone dropped into water.
      timers.push(setTimeout(() => ripple(r, fx.tier ?? 1), fx.delay ?? 0));
    }
    if (fx.kind === "bump") bump(fx.cardId, fx.targetId, fx.toPlayer ?? 1 - fx.controller);
    return () => timers.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rect) return null;

  const flipped = fx.controller !== me;
  const box = boxOf(rect);
  const ghost = (c: FxCard, w: number) => (
    <CardImage code={c.faceDown ? 0 : c.code} faceDown={c.faceDown} width={w} sideways={c.sideways} flipped={c.controller !== me} />
  );

  switch (fx.kind) {
    case "glow":
      return null;
    case "impact":
      // Drawn by moving the field cells themselves (see ripple).
      return null;
    case "bump":
      // Moves the attacking card itself (see bump).
      return null;
    case "material":
      return <Material fx={fx} rect={rect} flipped={flipped} ghost={ghost(fx, fx.sideways ? rect.height : rect.width)} />;
    case "destroy":
    case "battle": {
      const card = ghost(fx, fx.sideways ? rect.height : rect.width);
      return fx.kind === "battle" ? <BattleCut box={box} card={card} rect={rect} /> : <Shatter box={box} card={card} rect={rect} />;
    }
    default: {
      if (!tl) return null;
      const fp = fallPoint(rect, fx.dir ?? -1);
      const info = res?.cards.get(fx.code);
      switch (fx.kind) {
        case "fusion":
          return <FusionIn fx={fx} fp={fp} tl={tl} flipped={flipped} />;
        case "synchro": {
          let tuner = 0;
          let other = 0;
          for (const m of fx.materials ?? []) {
            const mi = res?.cards.get(m.code);
            const lv = Math.max(1, mi?.level ?? 1);
            if ((mi?.type ?? 0) & 0x1000) tuner += lv;
            else other += lv;
          }
          if (!tuner && !other) tuner = Math.max(1, info?.level ?? 1);
          return <SynchroIn fp={fp} tl={tl} tuner={tuner} other={other} />;
        }
        case "xyz":
          return <XyzIn zone={rect} tl={tl} color={attributeColor(info?.attribute ?? 0)} />;
        case "link":
          return <LinkIn code={fx.code} fp={fp} tl={tl} marker={fx.linkMarker ?? info?.linkMarker ?? 0} flipped={flipped} />;
      }
      return null;
    }
  }
}

const boxOf = (r: { left: number; top: number; width: number; height: number }): CSSProperties => ({
  position: "absolute",
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
});

/** The field cell a card sits in (cells are square and a bit bigger than the card). */
function cellOf(card: DOMRect): DOMRect {
  const cx = card.left + card.width / 2;
  const cy = card.top + card.height / 2;
  for (const el of document.querySelectorAll<HTMLElement>("[data-board] [data-cell]")) {
    const r = el.getBoundingClientRect();
    if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return r;
  }
  return card;
}

/** The spot above a zone where summoned cards wait before dropping (bigger, see LIFT). */
function fallPoint(zone: DOMRect, dir: 1 | -1) {
  const w = zone.width * LIFT.scale;
  const h = zone.height * LIFT.scale;
  const cx = zone.left + zone.width / 2;
  const cy = zone.top + zone.height / 2 + dir * LIFT.rise * zone.height;
  return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, cx, cy };
}
type FallPoint = ReturnType<typeof fallPoint>;

/* ---------- step 2: materials leave the field ---------- */

function Material({ fx, rect, flipped, ghost }: { fx: Fx; rect: DOMRect; flipped: boolean; ghost: ReactNode }) {
  const form = fx.form!;
  if (form.shape === "swirl") {
    // Fusion: the material twists away into a whirlpool.
    const w = fx.sideways ? rect.height : rect.width;
    const h = fx.sideways ? rect.width : rect.height;
    return (
      <div style={{ ...boxOf(rect), display: "grid", placeItems: "center" }}>
        <Swirl code={fx.code} width={w} height={h} from={0} to={1} fadeFrom={1} fadeTo={0} duration={MATERIAL_HOLD - 60} rotate={(fx.sideways ? 90 : 0) + (flipped ? 180 : 0)} />
      </div>
    );
  }
  if (form.shape === "glow") {
    // Link: the card, white and shining, flares and disappears where it is. If it wasn't
    // shown as picked (someone else's summon), it turns white first.
    const turn = fx.previewed ? 0 : 200;
    return (
      <div style={{ ...boxOf(rect), display: "grid", placeItems: "center" }}>
        <div
          style={{
            position: "relative",
            ["--c" as string]: form.color,
            animation: `${fx.previewed ? "" : `fxLinkWhiten ${turn}ms ease-out both, `}fxLinkVanish ${LINK_LEAD - turn - 40}ms cubic-bezier(.5,0,.8,.4) ${turn}ms both`,
          }}
        >
          {ghost}
          <div style={{ position: "absolute", inset: 0, borderRadius: 4, background: "#fff", opacity: 0.72, animation: fx.previewed ? undefined : `fxIn ${turn}ms ease-out both` }} />
        </div>
      </div>
    );
  }
  // Synchro / Xyz: the shapes float up and dissolve. If the card wasn't shown as
  // picked (opponent's summon), it turns into them first.
  const w = Math.min(rect.width, rect.height);
  const h = Math.max(rect.width, rect.height);
  return (
    <div style={boxOf(rect)}>
      {!fx.previewed && <div style={{ position: "absolute", inset: 0, animation: "fxFadeOut 200ms ease-in forwards" }}>{ghost}</div>}
      {/* Each shape leaves on its own, the top one first, accelerating: they string out. */}
      <LeavingForm form={form} width={w} height={h} formed={!!fx.previewed} />
    </div>
  );
}

/* ---------- step 5: Extra Deck summons ---------- */

/** Fusion: the monster swirls in above its zone (then the card drops, see LandPlan). */
function FusionIn({ fx, fp, tl, flipped }: { fx: Fx; fp: FallPoint; tl: SummonTimeline; flipped: boolean }) {
  return (
    <div style={{ ...boxOf(fp), animation: `fxHide 1ms linear ${tl.reveal}ms forwards` }}>
      <Swirl code={fx.code} width={fp.width} height={fp.height} from={-1} to={0} fadeFrom={0} fadeTo={1} duration={tl.reveal} rotate={flipped ? 180 : 0} />
    </div>
  );
}

/**
 * Synchro: rings (Tuner Levels) appear above the zone, spheres (other Levels) fall into
 * them, everything glows into the silhouette of a card, the card appears, then drops.
 */
function SynchroIn({ fp, tl, tuner, other }: { fp: FallPoint; tl: SummonTimeline; tuner: number; other: number }) {
  // One ring per Tuner Level, one sphere per Level of the other materials.
  const rings = Math.min(12, tuner);
  const spheres = Math.min(12, other);
  // A bit smaller than a field cell (the fall point is the card scaled by LIFT.scale).
  const ringD = (fp.height / LIFT.scale + 6) * 0.88;
  // Rings stacked with clear gaps so each one can be told apart (column at most ~2.4 cards tall).
  const gap = rings > 1 ? Math.min(ringD * 0.42, (fp.height * 2.4) / (rings - 1)) : 0;
  const colH = Math.max(ringD * 0.5, gap * (rings - 1));
  const glowAt = tl.reveal - 350;
  const local = (y: number): CSSProperties => ({ position: "absolute", left: fp.width / 2, top: y });
  // Spheres fall one after another in single file, accelerating, so they spread apart as
  // they go; the first one goes to the lowest slot.
  const fall = 380;
  const stagger = spheres > 1 ? Math.min(160, (glowAt - 300 - fall) / (spheres - 1)) : 0;
  return (
    <div style={boxOf(fp)}>
      {Array.from({ length: rings }, (_, i) => {
        const y = fp.height / 2 + (i - (rings - 1) / 2) * gap;
        return (
          <div
            key={`r${i}`}
            style={{
              ...local(y),
              width: ringD / RING_IMAGE_FILL,
              height: ringD / RING_IMAGE_FILL,
              marginLeft: -ringD / RING_IMAGE_FILL / 2,
              marginTop: -ringD / RING_IMAGE_FILL / 2,
              opacity: 0,
              ["--y" as string]: `${fp.height / 2 - y}px`,
              animation: `fxSyncRing ${tl.reveal}ms linear ${i * 40}ms forwards`,
            }}
          >
            <SynchroRing size={ringD} />
          </div>
        );
      })}
      {Array.from({ length: spheres }, (_, j) => {
        const slot = spheres === 1 ? fp.height / 2 : fp.height / 2 + colH / 2 - (j * colH) / (spheres - 1);
        const d = Math.max(6, Math.min(fp.width * 0.18, 16));
        const start = 300 + j * stagger;
        return (
          <div
            key={`s${j}`}
            style={{
              ...local(slot),
              width: d,
              height: d,
              marginLeft: -d / 2,
              marginTop: -d / 2,
              borderRadius: "50%",
              ...(shinyDotStyle as CSSProperties),
              opacity: 0,
              ["--from" as string]: `${-(fp.top + slot + 40)}px`,
              ["--y" as string]: `${fp.height / 2 - slot}px`,
              animation: `fxFallIn ${fall}ms cubic-bezier(.55,0,.9,.4) ${start}ms both, fxConverge 320ms ease-in ${glowAt}ms forwards`,
            }}
          />
        );
      })}
      {/* Everything turns into a glowing card silhouette, which fades as the card appears. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 6,
          background: `radial-gradient(ellipse at center, #f4fff0 0%, ${NEON_GREEN} 55%, ${NEON_GREEN}aa 100%)`,
          boxShadow: `0 0 18px 6px ${NEON_GREEN}, 0 0 40px 10px ${NEON_GREEN}66`,
          opacity: 0,
          animation: `fxInScale 300ms ease-out ${glowAt}ms forwards, fxOut 260ms ease-in ${tl.reveal}ms forwards`,
        }}
      />
    </div>
  );
}

/**
 * Xyz: the zone becomes a light tunnel, spheres in the monster's Attribute colour drop
 * into it one by one, the cell glows white after the last, the card appears above and
 * drops, and the glow dissolves on impact.
 */
function XyzIn({ zone, tl, color }: { zone: DOMRect; tl: SummonTimeline; color: string }) {
  const end = tl.impact;
  const d = Math.max(10, Math.min(zone.width * 0.32, 22));
  return (
    <>
      {/* The void behind the cells is drawn by the board (BoardVoid). */}
      {tl.hits.map((hit, i) => (
        <div key={i} style={boxOf(zone)}>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: d,
              height: d,
              marginLeft: -d / 2,
              marginTop: -d / 2,
              borderRadius: "50%",
              background: `radial-gradient(circle at 38% 35%, #fff, ${color} 50%, ${color}22 80%)`,
              boxShadow: `0 0 12px 4px ${color}`,
              opacity: 0,
              ["--from" as string]: `${-(zone.top + zone.height / 2 + 40)}px`,
              // Fast, accelerating fall...
              animation: `fxSphereDrop 150ms cubic-bezier(.7,0,1,.5) ${hit - 150}ms forwards`,
            }}
          />
          {/* ...and an explosion where it hits. */}
          <Burst size={Math.max(zone.width, zone.height) * 1.9} color={`${color}dd`} at={hit - 5} />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: Math.max(zone.width, zone.height) * 1.4,
              height: Math.max(zone.width, zone.height) * 1.4,
              marginLeft: -Math.max(zone.width, zone.height) * 0.7,
              marginTop: -Math.max(zone.width, zone.height) * 0.7,
              borderRadius: "50%",
              border: `3px solid ${color}`,
              boxShadow: `0 0 12px 3px ${color}`,
              opacity: 0,
              animation: `fxBlast 380ms ease-out ${hit}ms forwards`,
            }}
          />
        </div>
      ))}
      {tl.hits.map((hit, i) => (
        <Sparks key={`k${i}`} rect={zone} color={color} at={hit} count={16} />
      ))}
      {/* After the last sphere the whole cell glows yellow (its background turns yellow too, see
          BoardVoid), dissolving into sparks on impact. Only the glow is drawn here, so the
          card stays visible as it lands. */}
      <div
        style={{
          ...boxOf(cellOf(zone)),
          borderRadius: 4,
          boxShadow: "0 0 22px 8px rgba(255,213,79,.9), inset 0 0 16px 5px rgba(255,240,170,.9)",
          opacity: 0,
          animation: `fxIn 220ms ease-out ${tl.hits[tl.hits.length - 1]}ms forwards, fxDissolve 400ms ease-out ${end}ms forwards`,
        }}
      />
      <Sparks rect={zone} color="#ffe082" at={end} count={14} />
    </>
  );
}

/** Link Arrow bits clockwise from the top, with the picture of each (public/fx/link). */
const LINK_ARROWS: { bit: number; file: string }[] = [
  { bit: 0x080, file: "t" },
  { bit: 0x100, file: "tr" },
  { bit: 0x020, file: "r" },
  { bit: 0x004, file: "br" },
  { bit: 0x002, file: "b" },
  { bit: 0x001, file: "bl" },
  { bit: 0x008, file: "l" },
  { bit: 0x040, file: "tl" },
];

/**
 * Where the Link frame pictures live (public/fx/link): frame.svg plus one SVG per arrow in
 * dark/ (unlit) and light/ (lit). All are 2000x2000 and stack on top of each other, so
 * any of them can be replaced.
 */
const LINK_FX = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/fx/link`;
/** How much of the 2000-unit picture the card's height takes in the middle of the frame. */
const LINK_CARD_UNITS = 600;

/**
 * Link: after the materials vanish, the Link frame appears above the zone (bigger than a
 * cell) with every arrow dark. The monster's arrows light up one by one, the card appears
 * in the middle, the frame goes, and the card falls into its zone.
 */
function LinkIn({ code, fp, tl, marker, flipped }: { code: number; fp: FallPoint; tl: SummonTimeline; marker: number; flipped: boolean }) {
  // The pictures are square; the card fills LINK_CARD_UNITS of their 2000 units.
  const S = (fp.height * 2000) / LINK_CARD_UNITS;
  const frame = { left: fp.cx - S / 2, top: fp.cy - S / 2, width: S, height: S };
  const lit = LINK_ARROWS.filter((a) => marker & a.bit);
  // The frame clears just before the card falls (the card itself is drawn by the board).
  const grow = Math.round(FADE_MS * LINK_SPEED);
  const out = Math.max(tl.reveal + grow, tl.drop - 180);
  const layer: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" };
  return (
    <>
      <div
        style={{
          ...boxOf(frame),
          // Arrows point the way the monster faces: the opponent's are turned around.
          ["--rot" as string]: flipped ? "rotate(180deg)" : "rotate(0deg)",
          transform: "var(--rot)",
          opacity: 0,
          animation: `fxLinkFrameIn ${LINK_FRAME_IN}ms ease-out ${LINK_LEAD}ms forwards, fxOut ${tl.drop - out}ms ease-in ${out}ms forwards`,
        }}
      >
        <img src={`${LINK_FX}/frame.svg`} alt="" draggable={false} style={layer} />
        {LINK_ARROWS.map((a) => (
          <img key={`d${a.bit}`} src={`${LINK_FX}/dark/${a.file}.svg`} alt="" draggable={false} style={layer} />
        ))}
        {lit.map((a, i) => (
          // The lit arrow fades in over the dark one with a flash.
          <img
            key={`l${a.bit}`}
            src={`${LINK_FX}/light/${a.file}.svg`}
            alt=""
            draggable={false}
            style={{ ...layer, opacity: 0, animation: `fxLinkArrow ${Math.round(420 * LINK_SPEED)}ms ease-out ${tl.hits[i] ?? 0}ms forwards` }}
          />
        ))}
      </div>
      {/* The card appears in the middle of the frame (over it; the board's card is underneath
          and takes over when it falls). */}
      <div style={{ ...boxOf(fp), opacity: 0, animation: `fxGrowIn ${grow}ms ease-out ${tl.reveal}ms forwards, fxHide 1ms linear ${tl.drop}ms forwards` }}>
        <CardImage code={code} width={fp.width} flipped={flipped} />
      </div>
    </>
  );
}

/* ---------- battle ---------- */

/**
 * The attacker rushes into its target (or towards the opponent's LP bar for a direct
 * attack), knocks it back a little, and returns to its zone. Uses the card's `translate`
 * property, so its own rotation (defence position, the opponent's side) is kept.
 */
function bump(cardId: number, targetId: number | undefined, toPlayer: number) {
  const el = document.querySelector<HTMLElement>(`[data-board] [data-card-id="${cardId}"]`);
  const target =
    targetId !== undefined
      ? document.querySelector<HTMLElement>(`[data-board] [data-card-id="${targetId}"]`)
      : document.querySelector<HTMLElement>(`[data-lp="${toPlayer}"]`);
  if (!el || !target) return;
  const a = el.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  // A card: aim at its centre. The LP bar: the point of it straight across from the attacker.
  const bx = targetId !== undefined ? b.left + b.width / 2 : Math.min(b.right, Math.max(b.left, ax));
  const by = b.top + b.height / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy) || 1;
  // Stop where the two meet (edges touching, a little overlap for the hit).
  const reach = targetId !== undefined ? (Math.min(a.width, a.height) + Math.min(b.width, b.height)) * 0.42 : a.height * 0.45 + b.height / 2;
  const travel = Math.max(0, dist - reach);
  const tx = (dx / dist) * travel;
  const ty = (dy / dist) * travel;
  // Above the other cells while it moves.
  const cell = el.closest<HTMLElement>("[data-cell]");
  const z = cell?.style.zIndex ?? "";
  if (cell) cell.style.zIndex = "30";
  const anim = el.animate(
    [
      { translate: "0px 0px", scale: "1", easing: "cubic-bezier(.55,0,1,.45)" },
      { translate: `${tx}px ${ty}px`, scale: "1.08", offset: BUMP_HIT, easing: "ease-out" },
      { translate: `${tx * 0.9}px ${ty * 0.9}px`, scale: "1.04", offset: BUMP_HIT + 0.1, easing: "ease-in-out" },
      { translate: "0px 0px", scale: "1" },
    ],
    { duration: BUMP_MS },
  );
  anim.onfinish = anim.oncancel = () => {
    if (cell) cell.style.zIndex = z;
  };
  // The target is knocked back a little when it is hit.
  if (targetId !== undefined) {
    const kx = (dx / dist) * 8;
    const ky = (dy / dist) * 8;
    target.animate(
      [
        { translate: "0px 0px" },
        { translate: `${kx}px ${ky}px`, offset: 0.35 },
        { translate: `${-kx * 0.3}px ${-ky * 0.3}px`, offset: 0.7 },
        { translate: "0px 0px" },
      ],
      { duration: 260, delay: BUMP_MS * BUMP_HIT, easing: "ease-out" },
    );
  }
}

/* ---------- landing ---------- */

/**
 * A summoned card hits its zone: the cell dips and bounces back, and the cells around it
 * follow one after another with less and less force, like rings on water. Level 7+
 * hits harder and the wave travels further.
 */
function ripple(at: DOMRect, tier: 1 | 2) {
  const cells = document.querySelectorAll<HTMLElement>("[data-board] [data-cell]");
  const cx = at.left + at.width / 2;
  const cy = at.top + at.height / 2;
  const unit = Math.max(at.width, at.height) + 6;
  const reach = tier === 2 ? 5 : 3;
  const force = tier === 2 ? 0.17 : 0.11;
  const duration = tier === 2 ? 820 : 640;
  cells.forEach((el) => {
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const d = Math.hypot(dx, dy) / unit;
    if (d > reach) return;
    const amp = force * Math.exp(-d * 0.6);
    // Neighbours are pushed outwards a little as the wave passes.
    const len = Math.hypot(dx, dy) || 1;
    const push = d < 0.3 ? 0 : amp * unit * 0.35;
    const ux = (dx / len) * push;
    const uy = (dy / len) * push;
    el.animate(
      [
        { transform: "none", filter: "none" },
        { transform: `translate(${ux}px, ${uy}px) scale(${1 - amp})`, filter: `brightness(${1 + amp * 2.5})`, offset: 0.28 },
        { transform: `translate(${-ux * 0.45}px, ${-uy * 0.45}px) scale(${1 + amp * 0.5})`, filter: "brightness(1)", offset: 0.58 },
        { transform: `translate(${ux * 0.15}px, ${uy * 0.15}px) scale(${1 - amp * 0.18})`, offset: 0.82 },
        { transform: "none", filter: "none" },
      ],
      { duration, delay: d * (tier === 2 ? 75 : 65), easing: "ease-out" },
    );
  });
}

/** Small particles bursting out of a rect's centre. */
function Sparks({ rect, color, at, count, dust }: { rect: { width: number; height: number; left: number; top: number }; color: string; at: number; count: number; dust?: boolean }) {
  const size = Math.max(rect.width, rect.height);
  return (
    <div style={boxOf(rect)}>
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + (i % 2) * 0.2;
        const dist = size * (dust ? 0.7 : 0.9) * (0.75 + ((i * 37) % 25) / 100);
        const s = dust ? 4 + (i % 3) : 3 + (i % 2);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: dust ? "85%" : "50%",
              width: s,
              height: s,
              marginLeft: -s / 2,
              borderRadius: "50%",
              background: color,
              boxShadow: dust ? undefined : `0 0 6px 2px ${color}`,
              opacity: 0,
              ["--dx" as string]: `${Math.cos(a) * dist}px`,
              ["--dy" as string]: `${Math.sin(a) * dist * (dust ? 0.35 : 1)}px`,
              animation: `fxEmber ${dust ? 550 : 600}ms ease-out ${at + (i % 3) * 25}ms forwards`,
            }}
          />
        );
      })}
    </div>
  );
}

/** A flash where something hits. */
function Burst({ size, color, at }: { size: number; color: string; at: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: "50%",
        background: `radial-gradient(circle, #fff 0%, ${color} 35%, rgba(0,0,0,0) 70%)`,
        mixBlendMode: "screen",
        opacity: 0,
        animation: `fxBurst 420ms ease-out ${at}ms forwards`,
      }}
    />
  );
}

/* ---------- destroyed by an effect / by battle ---------- */

const SHARDS: { clip: string; dx: number; dy: number; rot: number }[] = [
  { clip: "0 0, 55% 0, 42% 44%, 0 34%", dx: -0.7, dy: -0.6, rot: -40 },
  { clip: "55% 0, 100% 0, 100% 40%, 42% 44%", dx: 0.7, dy: -0.7, rot: 35 },
  { clip: "0 34%, 42% 44%, 30% 100%, 0 100%", dx: -0.8, dy: 0.6, rot: 30 },
  { clip: "42% 44%, 100% 40%, 100% 100%, 66% 100%", dx: 0.8, dy: 0.7, rot: -30 },
  { clip: "42% 44%, 66% 100%, 30% 100%", dx: 0.05, dy: 1, rot: 60 },
];

function Shatter({ box, card, rect }: { box: CSSProperties; card: React.ReactNode; rect: DOMRect }) {
  const size = Math.max(rect.width, rect.height);
  return (
    <div style={box}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: size * 1.6,
          height: size * 1.6,
          marginLeft: -size * 0.8,
          marginTop: -size * 0.8,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,170,60,.85), rgba(255,90,30,.35) 45%, rgba(255,60,0,0) 70%)",
          opacity: 0,
          animation: "fxBurst 650ms ease-out 140ms forwards",
        }}
      />
      {SHARDS.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            inset: 0,
            clipPath: `polygon(${s.clip})`,
            ["--dx" as string]: `${s.dx * size * 0.9}px`,
            ["--dy" as string]: `${s.dy * size * 0.9}px`,
            ["--rot" as string]: `${s.rot}deg`,
            animation: "fxHeat 180ms ease-in forwards, fxShard 700ms cubic-bezier(.2,.6,.3,1) 170ms forwards",
          }}
        >
          {card}
        </div>
      ))}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#ffb347",
              boxShadow: "0 0 6px 2px rgba(255,120,30,.9)",
              opacity: 0,
              ["--dx" as string]: `${Math.cos(a) * size * 0.8}px`,
              ["--dy" as string]: `${Math.sin(a) * size * 0.8}px`,
              animation: `fxEmber 600ms ease-out ${170 + (i % 3) * 40}ms forwards`,
            }}
          />
        );
      })}
    </div>
  );
}

/* ---------- destroyed by battle: slashed in two ---------- */

function BattleCut({ box, card, rect }: { box: CSSProperties; card: React.ReactNode; rect: DOMRect }) {
  const size = Math.max(rect.width, rect.height);
  // The cut runs from the top-right to the bottom-left; halves fly apart across it.
  const angle = (Math.atan2(rect.height * 0.4, rect.width) * 180) / Math.PI;
  const halves = [
    { clip: "0 0, 100% 0, 100% 30%, 0 70%", dx: -0.25, dy: -0.35, rot: -12 },
    { clip: "0 70%, 100% 30%, 100% 100%, 0 100%", dx: 0.25, dy: 0.35, rot: 12 },
  ];
  return (
    <div style={box}>
      {halves.map((h, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            inset: 0,
            clipPath: `polygon(${h.clip})`,
            ["--dx" as string]: `${h.dx * size}px`,
            ["--dy" as string]: `${h.dy * size}px`,
            ["--rot" as string]: `${h.rot}deg`,
            animation: "fxHit 200ms ease-in forwards, fxHalf 650ms cubic-bezier(.3,.6,.3,1) 220ms forwards",
          }}
        >
          {card}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: size * 1.7,
          height: 4,
          marginLeft: -size * 0.85,
          marginTop: -2,
          borderRadius: 2,
          background: "linear-gradient(90deg, rgba(255,255,255,0), #fff 30%, #fff 70%, rgba(255,255,255,0))",
          boxShadow: "0 0 10px 3px rgba(255,80,80,.85)",
          transform: `rotate(${-angle}deg) scaleX(0)`,
          ["--angle" as string]: `${-angle}deg`,
          animation: "fxSlash 380ms ease-out 40ms forwards",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: -6,
          borderRadius: 8,
          background: "rgba(255,40,40,.45)",
          filter: "blur(6px)",
          opacity: 0,
          animation: "fxFlash 420ms ease-out 120ms forwards",
        }}
      />
    </div>
  );
}

const KEYFRAMES = `
@keyframes fxHide { to { opacity: 0; visibility: hidden; } }
@keyframes fxFadeOut { 0% { opacity: 1; } 100% { opacity: 0; } }
@keyframes fxSpinFallback { from { transform: rotate(0deg) scale(var(--s0)); opacity: var(--o0); } to { transform: rotate(var(--spin)) scale(var(--s1)); opacity: var(--o1); } }
@keyframes fxSyncRing {
  0% { opacity: 0; transform: scale(.3); }
  20% { opacity: 1; transform: scale(1); }
  72% { opacity: 1; transform: translateY(0) scale(1); filter: brightness(1); }
  100% { opacity: 0; transform: translateY(var(--y)) scale(.4); filter: brightness(2.5); }
}
@keyframes fxFallIn { from { opacity: 1; transform: translateY(var(--from)); } to { opacity: 1; transform: translateY(0); } }
@keyframes fxConverge { from { opacity: 1; transform: translateY(0) scale(1); filter: brightness(1); } to { opacity: 0; transform: translateY(var(--y)) scale(.4); filter: brightness(2.5); } }
@keyframes fxFollowUp { from { opacity: 1; transform: translate(-50%, -50%) scale(1); filter: blur(0); } to { opacity: 0; transform: translate(-50%, calc(-50% - var(--up))) scale(.65); filter: blur(2px); } }
@keyframes fxIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes fxInScale { from { opacity: 0; transform: scale(.88); } to { opacity: 1; transform: scale(1); } }
@keyframes fxOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes fxDissolve { from { opacity: 1; transform: scale(1); filter: blur(0); } to { opacity: 0; transform: scale(1.35); filter: blur(8px); } }
@keyframes fxSphereDrop { 0% { opacity: 1; transform: translateY(var(--from)); } 92% { opacity: 1; transform: translateY(0) scale(1.3); } 100% { opacity: 0; transform: translateY(0) scale(1.8); } }
@keyframes fxGrowIn { from { opacity: 0; transform: scale(.5); } to { opacity: 1; transform: scale(1); } }
@keyframes fxLinkFrameIn { from { opacity: 0; transform: var(--rot) scale(.85); } to { opacity: 1; transform: var(--rot) scale(1); } }
@keyframes fxLinkArrow {
  0% { opacity: 0; filter: brightness(2.6) drop-shadow(0 0 0 #1ec8ff); }
  35% { opacity: 1; filter: brightness(2.2) drop-shadow(0 0 14px #ffffff); }
  100% { opacity: 1; filter: brightness(1.1) drop-shadow(0 0 8px #ff7a4d); }
}
@keyframes fxLinkWhiten { from { filter: none; } to { filter: grayscale(1) brightness(1.9) drop-shadow(0 0 2px #fff) drop-shadow(0 0 7px var(--c)) drop-shadow(0 0 14px var(--c)); } }
@keyframes fxLinkVanish {
  0% { opacity: 1; transform: scale(1); filter: grayscale(1) brightness(1.9) drop-shadow(0 0 2px #fff) drop-shadow(0 0 7px var(--c)) drop-shadow(0 0 14px var(--c)); }
  40% { opacity: 1; transform: scale(1.08); filter: grayscale(1) brightness(2.6) drop-shadow(0 0 4px #fff) drop-shadow(0 0 14px var(--c)) drop-shadow(0 0 28px var(--c)); }
  100% { opacity: 0; transform: scale(.55); filter: grayscale(1) brightness(3) blur(3px) drop-shadow(0 0 10px var(--c)); }
}
@keyframes fxHeat { 0% { filter: none; } 100% { filter: brightness(1.8) sepia(.6) saturate(3) hue-rotate(-20deg); } }
@keyframes fxShard {
  0% { transform: translate(0, 0) rotate(0); opacity: 1; filter: brightness(1.8) sepia(.6) saturate(3) hue-rotate(-20deg); }
  100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; filter: brightness(.6); }
}
@keyframes fxBurst { 0% { opacity: 0; transform: scale(.3); } 30% { opacity: 1; } 100% { opacity: 0; transform: scale(1.2); } }
@keyframes fxEmber { 0% { opacity: 1; transform: translate(0, 0) scale(1); } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(.3); } }
@keyframes fxHit { 0% { filter: none; transform: translate(0, 0); } 40% { transform: translate(-3px, 2px); } 70% { transform: translate(3px, -2px); } 100% { filter: brightness(1.6) saturate(1.4); transform: translate(0, 0); } }
@keyframes fxHalf {
  0% { transform: translate(0, 0) rotate(0); opacity: 1; filter: brightness(1.6) saturate(1.4); }
  100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; filter: grayscale(.6) brightness(.7); }
}
@keyframes fxSlash { 0% { opacity: 1; transform: rotate(var(--angle)) scaleX(0); } 45% { opacity: 1; transform: rotate(var(--angle)) scaleX(1); } 100% { opacity: 0; transform: rotate(var(--angle)) scaleX(1.05); } }
@keyframes fxBlast { 0% { opacity: 1; transform: scale(.15); } 100% { opacity: 0; transform: scale(1); } }
@keyframes fxFlash { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
`;
